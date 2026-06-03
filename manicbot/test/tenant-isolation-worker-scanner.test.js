/**
 * Unit fixtures for the Worker tenant-isolation scanner's pure core
 * (deriveTenantScopedTables / scanSource). Pins the raw-SQL detection logic so
 * the mutation coverage and table-derivation guarantees can't silently regress.
 */
import { describe, it, expect } from "vitest";
import {
  deriveTenantScopedTables,
  scanSource,
  PLATFORM_GLOBAL_TABLES,
} from "../scripts/check-tenant-isolation-worker.mjs";

const TENANT = new Set(["appointments", "marketing_contacts", "channel_configs"]);

describe("worker scanner — deriveTenantScopedTables", () => {
  it("includes CREATE TABLE bodies with a tenant_id column", () => {
    const sql =
      "CREATE TABLE appointments (id TEXT, tenant_id TEXT NOT NULL);\n" +
      "CREATE TABLE IF NOT EXISTS services (id TEXT, tenant_id TEXT NOT NULL);";
    const s = deriveTenantScopedTables(sql);
    expect(s.has("appointments")).toBe(true);
    expect(s.has("services")).toBe(true);
  });

  it("excludes two-tenant relationship tables (referrer_tenant_id / invitee_tenant_id)", () => {
    const sql =
      "CREATE TABLE referrals (id TEXT, referrer_tenant_id TEXT NOT NULL, invitee_tenant_id TEXT NOT NULL);";
    expect(deriveTenantScopedTables(sql).has("referrals")).toBe(false);
  });

  it("excludes PLATFORM_GLOBAL tables even with a tenant_id column", () => {
    const sql = "CREATE TABLE web_users (id TEXT, tenant_id TEXT);";
    expect(deriveTenantScopedTables(sql).has("web_users")).toBe(false);
    expect(PLATFORM_GLOBAL_TABLES.has("web_users")).toBe(true);
  });
});

describe("worker scanner — scanSource", () => {
  it("flags an UPDATE on a tenant table with only an id predicate", () => {
    const src = "await dbRun(ctx, 'UPDATE appointments SET status = ? WHERE id = ?', s, id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("accepts an UPDATE scoped by tenant_id", () => {
    const src =
      "await dbRun(ctx, 'UPDATE appointments SET status = ? WHERE id = ? AND tenant_id = ?', s, id, t);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("flags a SELECT ... FROM on a tenant table without tenant_id", () => {
    const src = "await dbAll(ctx, 'SELECT * FROM marketing_contacts WHERE id = ?', id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("flags an INSERT that omits tenant_id, accepts one that includes it", () => {
    const bad = "await dbRun(ctx, 'INSERT INTO marketing_contacts (id, email) VALUES (?, ?)', id, e);";
    const ok = "await dbRun(ctx, 'INSERT INTO marketing_contacts (id, tenant_id, email) VALUES (?, ?, ?)', id, t, e);";
    expect(scanSource(bad, TENANT)).toHaveLength(1);
    expect(scanSource(ok, TENANT)).toHaveLength(0);
  });

  it("accepts a web_user-scoped query (web_user_id predicate)", () => {
    const src = "await dbAll(ctx, 'SELECT * FROM push_subscriptions WHERE web_user_id = ?', uid);";
    expect(scanSource(src, new Set(["push_subscriptions"]))).toHaveLength(0);
  });

  it("ignores tables outside the tenant set (global lookup)", () => {
    const src = "await dbGet(ctx, 'SELECT * FROM tenants WHERE bot_id = ?', botId);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("accepts a query annotated with a tenant-scan-ignore directive", () => {
    const src =
      "// tenant-scan-ignore: bot/webhook → tenant resolver for inbound routing\n" +
      "const row = await dbGet(ctx, 'SELECT id, secret FROM channel_configs WHERE channel_user_id = ?', u);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("still flags the same resolver query WITHOUT the directive", () => {
    const src = "const row = await dbGet(ctx, 'SELECT id, secret FROM channel_configs WHERE channel_user_id = ?', u);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });
});

// Gap A — for UPDATE/DELETE the tenant predicate must sit in the WHERE filter,
// not merely anywhere in the statement. `UPDATE t SET tenant_id=? WHERE id=?`
// writes the tenant column but filters rows by id alone → a cross-tenant write.
// Mirrors PR #350's admin-app fix, adapted to the raw-SQL model.
describe("worker scanner — Gap A: UPDATE/DELETE tenant predicate must be in WHERE", () => {
  it("flags an UPDATE that sets tenant_id but filters rows by id alone", () => {
    const src =
      "await dbRun(ctx, 'UPDATE appointments SET tenant_id = ?, status = ? WHERE id = ?', t, s, id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("accepts an UPDATE whose WHERE carries tenant_id (id + tenant_id)", () => {
    const src =
      "await dbRun(ctx, 'UPDATE appointments SET status = ? WHERE id = ? AND tenant_id = ?', s, id, t);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("flags a multi-line UPDATE with tenant_id only in the SET, id-only WHERE", () => {
    const src =
      "await dbRun(ctx, `UPDATE marketing_contacts\n" +
      "     SET tenant_id = ?, email = ?\n" +
      "   WHERE id = ?`, t, e, id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("accepts a multi-line UPDATE with tenant_id in the WHERE", () => {
    const src =
      "await dbRun(ctx, `UPDATE marketing_contacts\n" +
      "     SET email = ?\n" +
      "   WHERE id = ? AND tenant_id = ?`, e, id, t);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("flags an UPDATE on a tenant table with NO where clause at all", () => {
    const src = "await dbRun(ctx, 'UPDATE appointments SET status = ?', s);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("flags a DELETE whose row filter is id alone (tenant_id absent from WHERE)", () => {
    const src = "await dbRun(ctx, 'DELETE FROM appointments WHERE id = ?', id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("accepts a DELETE scoped by tenant_id in the WHERE", () => {
    const src = "await dbRun(ctx, 'DELETE FROM appointments WHERE tenant_id = ? AND id = ?', t, id);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("still accepts a SELECT that carries tenant_id anywhere in the statement", () => {
    // SELECT has no SET clause; the loose anywhere-in-window rule still applies.
    const src = "await dbAll(ctx, 'SELECT id FROM appointments WHERE tenant_id = ? AND ts > ?', t, since);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("still accepts an INSERT carrying tenant_id in its VALUES (no WHERE)", () => {
    const src =
      "await dbRun(ctx, 'INSERT INTO appointments (id, tenant_id, status) VALUES (?, ?, ?)', id, t, s);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });

  it("accepts an UPDATE missing a WHERE tenant predicate when annotated with a directive", () => {
    const src =
      "// tenant-scan-ignore: contact resolved above by capability token; keyed by PK\n" +
      "await dbRun(ctx, 'UPDATE marketing_contacts SET unsubscribe_token = ? WHERE id = ?', tok, id);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });
});

// Gap B — SQL comments are stripped before the predicate test, so a commented
// `-- tenant_id` or `/* tenant_id */` can't spoof the isolation check.
describe("worker scanner — Gap B: SQL comments stripped before the keyword test", () => {
  it("flags a SELECT whose only tenant_id is inside a /* */ block comment", () => {
    const src =
      "await dbAll(ctx, 'SELECT * FROM marketing_contacts /* tenant_id handled upstream */ WHERE id = ?', id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("flags a SELECT whose only tenant_id is inside a -- line comment", () => {
    const src =
      "await dbAll(ctx, `SELECT * FROM marketing_contacts\n" +
      "  -- tenant_id is implied\n" +
      "  WHERE id = ?`, id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("flags an UPDATE whose WHERE tenant_id is only a commented-out clause", () => {
    const src =
      "await dbRun(ctx, 'UPDATE appointments SET status = ? WHERE id = ? /* AND tenant_id = ? */', s, id);";
    expect(scanSource(src, TENANT)).toHaveLength(1);
  });

  it("still accepts a real tenant_id predicate alongside a comment", () => {
    const src =
      "await dbRun(ctx, 'UPDATE appointments SET status = ? WHERE id = ? AND tenant_id = ? -- scoped', s, id, t);";
    expect(scanSource(src, TENANT)).toHaveLength(0);
  });
});
