/**
 * #D-1 — tenantStaff.revokeMember tenant-isolation regression.
 *
 * `revokeMember` flips a member's role to `client` and nulls their tenantId.
 * The `ownerOnlyForTenant(ctx, input.tenantId)` guard only proves the CALLER
 * owns `input.tenantId` — but the `UPDATE web_users` was keyed by `id` ALONE
 * (no tenant predicate). So a tenant_owner of A, passing their OWN tenantId=A
 * plus a `webUserId` belonging to tenant B, could demote/lock-out B's owner or
 * manager. The `tenant_member_permissions` DELETE two lines above was already
 * tenant-scoped; only the `web_users` write leaked.
 *
 * REAL in-memory libsql so the WHERE clause is genuinely exercised. Fails on
 * the pre-fix unscoped UPDATE; passes once `eq(webUsers.tenantId, tenantId)` is
 * added.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { WORKER_PUBLIC_URL: "https://worker.test", ADMIN_KEY: "test-admin-key", AUTH_SECRET: "test-secret" },
}));
vi.mock("~/server/email/emailService", () => ({
  sendPermissionElevationCodeEmail: vi.fn(async () => undefined),
  sendVerificationCodeEmail: vi.fn(async () => undefined),
}));
vi.mock("~/server/email/resend", () => ({ isResendConfigured: () => false }));
vi.mock("~/server/auth/rateLimit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 5 })) }));

const NOW = 1_780_000_000;
const DDL = [
  `CREATE TABLE web_users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'tenant_owner', tenant_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE tenant_member_permissions (tenant_id TEXT NOT NULL, web_user_id TEXT NOT NULL, permission TEXT NOT NULL, granted_at INTEGER NOT NULL, granted_by TEXT NOT NULL, PRIMARY KEY (tenant_id, web_user_id, permission))`,
  `CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, actor TEXT, action TEXT NOT NULL, detail TEXT, ip TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
];

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  for (const s of DDL) await client.execute(s);
  const db = drizzle(client, { schema });
  // Victim: owner of a DIFFERENT tenant B.
  await client.execute({
    sql: `INSERT INTO web_users (id,email,role,tenant_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
    args: ["u_victim_B", "victim@x.io", "tenant_owner", "B", NOW, NOW],
  });
  // Legit member (manager) of the caller's own tenant A.
  await client.execute({
    sql: `INSERT INTO web_users (id,email,role,tenant_id,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
    args: ["u_member_A", "mgr@x.io", "tenant_manager", "A", NOW, NOW],
  });
  await client.execute({
    sql: `INSERT INTO tenant_member_permissions (tenant_id,web_user_id,permission,granted_at,granted_by) VALUES (?,?,?,?,?)`,
    args: ["A", "u_member_A", "clients.view", NOW, "owner@x.io"],
  });
  return { db, client };
}

function ownerCtx(db: unknown, tenantId: string) {
  return { db: db as never, webUser: { id: "w_owner", email: "owner@x.io", tenantId, webRole: "tenant_owner" }, headers: new Headers() };
}

describe("tenantStaff.revokeMember — tenant isolation (#D-1)", () => {
  it("does NOT demote a web_user belonging to another tenant", async () => {
    const { db, client } = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { tenantStaffRouter } = await import("~/server/api/routers/tenantStaff");
    const caller = createCallerFactory(tenantStaffRouter)(ownerCtx(db, "A") as never);

    // Owner of tenant A passes their OWN tenantId + tenant B's user id.
    await caller.revokeMember({ tenantId: "A", webUserId: "u_victim_B" });

    const r = await client.execute({ sql: "SELECT role, tenant_id FROM web_users WHERE id = ?", args: ["u_victim_B"] });
    const row = r.rows[0]!;
    expect(row.role).toBe("tenant_owner"); // unchanged — cross-tenant write blocked
    expect(row.tenant_id).toBe("B"); // still a member of their own tenant
  });

  it("DOES revoke a real member of the caller's own tenant (control)", async () => {
    const { db, client } = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { tenantStaffRouter } = await import("~/server/api/routers/tenantStaff");
    const caller = createCallerFactory(tenantStaffRouter)(ownerCtx(db, "A") as never);

    await caller.revokeMember({ tenantId: "A", webUserId: "u_member_A" });

    const r = await client.execute({ sql: "SELECT role, tenant_id FROM web_users WHERE id = ?", args: ["u_member_A"] });
    expect(r.rows[0]!.role).toBe("client");
    expect(r.rows[0]!.tenant_id).toBeNull();
    const p = await client.execute({ sql: "SELECT COUNT(*) c FROM tenant_member_permissions WHERE web_user_id = ?", args: ["u_member_A"] });
    expect(Number(p.rows[0]!.c)).toBe(0);
  });
});
