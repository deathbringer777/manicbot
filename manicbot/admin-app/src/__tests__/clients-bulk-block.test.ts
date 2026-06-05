/**
 * clients.bulkSetGlobalBlock — bulk tenant-wide block / unblock.
 *
 * The Clients-tab bulk action toolbar blocks or unblocks the whole selection
 * in one call. Mirrors the single `setGlobalBlock` (is_blocked_global toggle +
 * reason + timestamp + audit) but set-based via `inArray`, with ONE summary
 * audit row for the batch instead of one per client.
 *
 * REAL in-memory libsql so the set-based UPDATE + tenant scoping run for real.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({ env: { WORKER_PUBLIC_URL: "https://worker.test", ADMIN_KEY: "k", AUTH_SECRET: "s" } }));
vi.mock("~/server/clients/marketingSync", () => ({ syncMarketingContact: vi.fn(async () => null) }));

const NOW = 1_780_000_000;
const DDL = [
  `CREATE TABLE users (tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, is_blocked_global INTEGER NOT NULL DEFAULT 0, blocked_global_reason TEXT, blocked_global_at INTEGER, updated_at INTEGER, registered_at INTEGER, PRIMARY KEY (tenant_id, chat_id))`,
  `CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, actor TEXT, action TEXT NOT NULL, detail TEXT, ip TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
];

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  for (const s of DDL) await client.execute(s);
  const db = drizzle(client, { schema });
  return { db, client };
}

function ownerCtx(db: unknown, tenantId: string) {
  return { db: db as never, webUser: { id: "w_owner", email: "owner@x.io", tenantId, webRole: "tenant_owner" }, headers: new Headers() };
}

async function seedUser(client: any, tenantId: string, chatId: number, blocked = 0) {
  await client.execute({
    sql: `INSERT INTO users (tenant_id,chat_id,name,is_blocked_global,blocked_global_reason,blocked_global_at,registered_at) VALUES (?,?,?,?,?,?,?)`,
    args: [tenantId, chatId, `c${chatId}`, blocked, blocked ? "old" : null, blocked ? NOW : null, NOW],
  });
}

describe("clients.bulkSetGlobalBlock", () => {
  it("blocks every id with reason + timestamp and writes one audit row", async () => {
    const { db, client } = await freshDb();
    await seedUser(client, "A", 100);
    await seedUser(client, "A", 101);
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    const res = await caller.bulkSetGlobalBlock({ tenantId: "A", chatIds: [100, 101], blocked: true, reason: "no-show x3" });
    expect(res.updated).toBe(2);

    const u = await client.execute("SELECT chat_id, is_blocked_global, blocked_global_reason, blocked_global_at FROM users WHERE tenant_id='A' ORDER BY chat_id");
    for (const row of u.rows) {
      expect(Number(row.is_blocked_global)).toBe(1);
      expect(row.blocked_global_reason).toBe("no-show x3");
      expect(Number(row.blocked_global_at)).toBeGreaterThan(0);
    }

    const a = await client.execute("SELECT action, tenant_id FROM audit_log WHERE action='clients.bulkBlock'");
    expect(a.rows.length).toBe(1);
    expect(a.rows[0]!.tenant_id).toBe("A");
  });

  it("unblock clears reason + timestamp and audits as bulkUnblock", async () => {
    const { db, client } = await freshDb();
    await seedUser(client, "A", 100, 1);
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    await caller.bulkSetGlobalBlock({ tenantId: "A", chatIds: [100], blocked: false });

    const u = await client.execute("SELECT is_blocked_global, blocked_global_reason, blocked_global_at FROM users WHERE tenant_id='A' AND chat_id=100");
    expect(Number(u.rows[0]!.is_blocked_global)).toBe(0);
    expect(u.rows[0]!.blocked_global_reason).toBeNull();
    expect(u.rows[0]!.blocked_global_at).toBeNull();

    const a = await client.execute("SELECT action FROM audit_log WHERE action='clients.bulkUnblock'");
    expect(a.rows.length).toBe(1);
  });

  it("does not touch another tenant's rows", async () => {
    const { db, client } = await freshDb();
    await seedUser(client, "A", 100);
    await seedUser(client, "B", 100); // same chatId, different tenant
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    await caller.bulkSetGlobalBlock({ tenantId: "A", chatIds: [100], blocked: true });

    const b = await client.execute("SELECT is_blocked_global FROM users WHERE tenant_id='B' AND chat_id=100");
    expect(Number(b.rows[0]!.is_blocked_global)).toBe(0); // untouched
  });
});
