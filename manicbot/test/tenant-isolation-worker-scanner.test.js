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
