/**
 * clients.exportCsv — "export selected" (chatIds branch).
 *
 * The Clients-tab bulk toolbar can export EXACTLY the ticked rows. When
 * `chatIds` is supplied the export filters by `inArray(users.chatId, …)`
 * (still tenant-scoped) instead of the filter set. Pins:
 *   * Only the given ids are exported (a non-selected same-tenant row is out).
 *   * Tenant isolation holds: another tenant's row with the same chatId never
 *     leaks into the export.
 *
 * REAL in-memory libsql with the full `users` DDL so the all-columns SELECT +
 * inArray actually run.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({ env: { WORKER_PUBLIC_URL: "https://worker.test", ADMIN_KEY: "k", AUTH_SECRET: "s" } }));
vi.mock("~/server/clients/marketingSync", () => ({ syncMarketingContact: vi.fn(async () => null) }));

const NOW = 1_780_000_000;
// Full users DDL (mirrors src/db/schema.sql) — exportCsv does `.select()` over
// every column, so a partial table would fail with "no such column".
const USERS_DDL = `CREATE TABLE users (
  tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, tg_username TEXT, tg_lang TEXT,
  phone TEXT, registered_at INTEGER, tos_accepted_at INTEGER, first_source TEXT, first_campaign TEXT,
  first_medium TEXT, first_touch_at INTEGER, dob TEXT, email TEXT, ig_username TEXT, notes TEXT, tags TEXT,
  marketing_contact_id INTEGER, email_opt_in INTEGER, email_prompt_last_at INTEGER, email_prompt_count INTEGER NOT NULL DEFAULT 0, is_blocked_global INTEGER NOT NULL DEFAULT 0, blocked_global_reason TEXT,
  blocked_global_at INTEGER, updated_at INTEGER, deleted_at INTEGER, lifetime_visits INTEGER NOT NULL DEFAULT 0,
  last_visit_at INTEGER, avatar_emoji TEXT, avatar_url TEXT, avatar_r2_key TEXT, favorite_master_id INTEGER,
  PRIMARY KEY (tenant_id, chat_id)
)`;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute(USERS_DDL);
  const db = drizzle(client, { schema });
  const ins = async (tenantId: string, chatId: number, name: string, email: string) =>
    client.execute({
      sql: `INSERT INTO users (tenant_id,chat_id,name,email,phone,registered_at,last_visit_at) VALUES (?,?,?,?,?,?,?)`,
      args: [tenantId, chatId, name, email, `+4800${chatId}`, NOW, NOW],
    });
  await ins("A", 100, "Anna", "anna@x.io");
  await ins("A", 101, "Bob", "bob@x.io");
  await ins("B", 100, "Boris", "boris@x.io"); // same chatId, different tenant
  return { db, client };
}

function ownerCtx(db: unknown, tenantId: string) {
  return { db: db as never, webUser: { id: "w_owner", email: "owner@x.io", tenantId, webRole: "tenant_owner" }, headers: new Headers() };
}

describe("clients.exportCsv — export selected (chatIds)", () => {
  it("exports only the given ids", async () => {
    const { db } = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    const out = await caller.exportCsv({ tenantId: "A", chatIds: [100] });
    expect(out.data).toContain("Anna");
    expect(out.data).not.toContain("Bob"); // 101 not selected
  });

  it("never leaks another tenant's row with the same chatId", async () => {
    const { db } = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    const out = await caller.exportCsv({ tenantId: "A", chatIds: [100] });
    expect(out.data).not.toContain("Boris"); // tenant B, same chatId
  });

  it("falls back to the full filtered set when chatIds is omitted", async () => {
    const { db } = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "A") as never);

    const out = await caller.exportCsv({ tenantId: "A" });
    expect(out.data).toContain("Anna");
    expect(out.data).toContain("Bob"); // both tenant-A rows
    expect(out.data).not.toContain("Boris");
  });
});
