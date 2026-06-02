/**
 * #D-2 / #D-3 — client deletion (right-to-erasure) completeness + audit.
 *
 * `clients.delete` soft-deletes the `users` row and nulls its PII, but it left
 * a verbatim copy of name/email/phone in the linked `marketing_contacts` row
 * (still queryable in marketing audiences + CSV exports) → a GDPR erasure that
 * leaves PII behind (#D-2). It also wrote no audit record (#D-3).
 *
 * REAL in-memory libsql so the cross-table scrub + audit write are exercised.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({ env: { WORKER_PUBLIC_URL: "https://worker.test", ADMIN_KEY: "k", AUTH_SECRET: "s" } }));
vi.mock("~/server/clients/marketingSync", () => ({ syncMarketingContact: vi.fn(async () => null) }));
vi.mock("~/server/utils/notifyWorker", () => ({ notifyWorker: vi.fn(async () => undefined) }));

const NOW = 1_780_000_000;
const DDL = [
  `CREATE TABLE users (tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, phone TEXT, email TEXT, tg_username TEXT, ig_username TEXT, notes TEXT, tags TEXT, dob TEXT, is_blocked_global INTEGER NOT NULL DEFAULT 0, blocked_global_reason TEXT, blocked_global_at INTEGER, deleted_at INTEGER, updated_at INTEGER, registered_at INTEGER)`,
  `CREATE TABLE marketing_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, name TEXT, phone TEXT, source TEXT, first_seen_at INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL DEFAULT 0, lead_count INTEGER NOT NULL DEFAULT 1, unsubscribed INTEGER NOT NULL DEFAULT 0, tenant_id TEXT, linked_user_chat_id INTEGER)`,
  `CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT, actor TEXT, action TEXT NOT NULL, detail TEXT, ip TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`,
];

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  for (const s of DDL) await client.execute(s);
  const db = drizzle(client, { schema });
  await client.execute({ sql: `INSERT INTO users (tenant_id,chat_id,name,phone,email,tg_username,registered_at) VALUES (?,?,?,?,?,?,?)`, args: ["A", 100, "Anna", "+48111", "anna@x.io", "anna_tg", NOW] });
  await client.execute({ sql: `INSERT INTO marketing_contacts (tenant_id,linked_user_chat_id,name,email,phone,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?)`, args: ["A", 100, "Anna", "anna@x.io", "+48111", NOW, NOW] });
  return { db, client };
}

function ownerCtx(db: unknown, tenantId: string) {
  return { db: db as never, webUser: { id: "w_owner", email: "owner@x.io", tenantId, webRole: "tenant_owner" }, headers: new Headers() };
}

describe("clients.delete — GDPR erasure completeness + audit (#D-2/#D-3)", () => {
  it("scrubs the linked marketing_contacts PII and writes an audit row", async () => {
    const { db, client } = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    await caller.delete({ tenantId: "A", chatId: 100 });

    // users PII gone (existing behaviour)
    const u = await client.execute({ sql: "SELECT name, phone, email FROM users WHERE tenant_id=? AND chat_id=?", args: ["A", 100] });
    expect(u.rows[0]!.name).toBeNull();
    expect(u.rows[0]!.phone).toBeNull();

    // #D-2 — marketing_contacts PII copy must also be scrubbed
    const m = await client.execute({ sql: "SELECT name, email, phone, unsubscribed FROM marketing_contacts WHERE tenant_id=? AND linked_user_chat_id=?", args: ["A", 100] });
    expect(m.rows[0]!.name).toBeNull();
    expect(m.rows[0]!.email).toBeNull();
    expect(m.rows[0]!.phone).toBeNull();
    expect(Number(m.rows[0]!.unsubscribed)).toBe(1);

    // #D-3 — an audit row must be written
    const a = await client.execute("SELECT action, tenant_id FROM audit_log WHERE action='clients.delete'");
    expect(a.rows.length).toBe(1);
    expect(a.rows[0]!.tenant_id).toBe("A");
  });

  it("does not touch another tenant's marketing_contacts row", async () => {
    const { db, client } = await freshDb();
    await client.execute({ sql: `INSERT INTO marketing_contacts (tenant_id,linked_user_chat_id,name,email,phone,first_seen_at,last_seen_at) VALUES (?,?,?,?,?,?,?)`, args: ["B", 100, "Boris", "boris@x.io", "+48999", NOW, NOW] });
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    await caller.delete({ tenantId: "A", chatId: 100 });

    const b = await client.execute({ sql: "SELECT name FROM marketing_contacts WHERE tenant_id=? AND linked_user_chat_id=?", args: ["B", 100] });
    expect(b.rows[0]!.name).toBe("Boris"); // untouched — tenant-scoped scrub
  });
});
