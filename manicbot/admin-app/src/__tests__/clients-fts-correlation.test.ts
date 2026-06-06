/**
 * Defense-in-depth guard (F-1/F-2): the `clients.list` FTS5 search path MUST
 * keep its correlated subquery genuinely correlated to the OUTER `users` row,
 * i.e. `users_fts.chat_id = users.chat_id` — NOT the degenerate self-reference
 * `users_fts.chat_id = users_fts.chat_id` (a tautology that would make the
 * EXISTS mean "does ANY row of this tenant match?" and return the tenant's
 * WHOLE client list for a single hit — a same-tenant over-match, never a
 * cross-tenant leak, since the `tenant_id` literal pins the caller's tenant on
 * both the outer query and the subquery).
 *
 * REAL SQL (in-memory libsql) so the Drizzle-generated correlation is actually
 * exercised — the mock-db parser ignores WHERE/subquery shape and would mask
 * this class of defect entirely.
 *
 * Investigation note (why there is no code change): Drizzle already compiles
 * `${users.chatId}` to the QUALIFIED identifier `"users"."chat_id"` here,
 * because this EXISTS subquery sits in the WHERE clause of `.from(users)` so
 * the outer table is in lexical scope (verified via `toSQL()`:
 * `… WHERE users_fts.chat_id = "users"."chat_id" …`). This differs from the N9
 * `appointmentNames.ts` leak, where a SCALAR subquery in the SELECT list made
 * Drizzle emit BARE `"chat_id"` on both sides — a real tautology that needed
 * the explicit `col()` helper. The bare form genuinely over-matches (proven in
 * the investigation), but the router never generates it. This file PINS that
 * runtime invariant so a future refactor (scalar-subquery rewrite, outer-table
 * aliasing, or a hand-written bare correlation) is caught.
 *
 * These cases insert a DECOY tenant FIRST (lowest rowid) and put a
 * non-matching client ("Борис") in the searched tenant; they assert the search
 * resolves to ONLY the matching client. They go RED the moment the correlation
 * degrades to the bare/tautological form.
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: {
    WORKER_PUBLIC_URL: "https://worker.test",
    ADMIN_KEY: "test-admin-key",
    ADMIN_CHAT_ID: "12345",
    TELEGRAM_BOT_TOKEN: "0:TEST",
    AUTH_SECRET: "test-secret",
  },
}));
vi.mock("~/server/clients/marketingSync", () => ({
  syncMarketingContact: vi.fn(async () => null),
}));

const NOW = 1_780_000_000;

// users schema mirrored from migration 0062 (only the columns clients.list
// reads/writes are needed; the real table has 30+).
const CREATE_USERS = `CREATE TABLE users (tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, tg_username TEXT, tg_lang TEXT, phone TEXT, registered_at INTEGER, tos_accepted_at INTEGER, first_source TEXT, first_campaign TEXT, first_medium TEXT, first_touch_at INTEGER, dob TEXT, email TEXT, ig_username TEXT, notes TEXT, tags TEXT, marketing_contact_id INTEGER, email_opt_in INTEGER, email_prompt_last_at INTEGER, email_prompt_count INTEGER NOT NULL DEFAULT 0, is_blocked_global INTEGER NOT NULL DEFAULT 0, blocked_global_reason TEXT, blocked_global_at INTEGER, updated_at INTEGER, deleted_at INTEGER, lifetime_visits INTEGER NOT NULL DEFAULT 0, last_visit_at INTEGER, avatar_emoji TEXT, avatar_url TEXT, avatar_r2_key TEXT, favorite_master_id INTEGER)`;

// FTS5 virtual table — identical shape to migration 0062's `users_fts`.
const CREATE_USERS_FTS = `CREATE VIRTUAL TABLE users_fts USING fts5(tenant_id UNINDEXED, chat_id UNINDEXED, search_text, tokenize='unicode61 remove_diacritics 1')`;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute(CREATE_USERS);
  await client.execute(CREATE_USERS_FTS);
  const db = drizzle(client, { schema });

  // DECOY tenant FIRST (lowest rowid). Same searchable token ("анна") as the
  // real tenant so a broken correlation has a tempting wrong row to grab.
  await db.insert(schema.users).values({ tenantId: "t_decoy", chatId: 9001, name: "Анна Декой", phone: "+48000DECOY", registeredAt: NOW, lastVisitAt: NOW });

  // Searched tenant: ONE matching client ("Анна") + ONE non-matching client
  // ("Борис"). The over-match bug pulls Борис into an "анна" search.
  await db.insert(schema.users).values({ tenantId: "t_a", chatId: 1001, name: "Анна Иванова", phone: "+48111", registeredAt: NOW, lastVisitAt: NOW + 2 });
  await db.insert(schema.users).values({ tenantId: "t_a", chatId: 1002, name: "Борис Петров", phone: "+48222", registeredAt: NOW, lastVisitAt: NOW + 1 });

  // Seed the FTS index by hand (the prod triggers aren't part of this
  // narrow schema). search_text mirrors the 0062 trigger: lower-cased
  // concatenation of the searchable fields.
  const seed = async (tenantId: string, chatId: number, text: string) =>
    client.execute({
      sql: `INSERT INTO users_fts(tenant_id, chat_id, search_text) VALUES (?, ?, ?)`,
      args: [tenantId, chatId, text.toLowerCase()],
    });
  await seed("t_decoy", 9001, "анна декой +48000decoy");
  await seed("t_a", 1001, "анна иванова +48111");
  await seed("t_a", 1002, "борис петров +48222");

  return db;
}

function ownerCtx(db: unknown, tenantId: string) {
  return {
    db: db as never,
    webUser: { id: "w_owner", email: "o@x.io", tenantId, webRole: "tenant_owner" },
    headers: new Headers(),
  };
}

describe("clients.list FTS subquery stays correlated to the outer client row", () => {
  it("search returns ONLY the matching client, not the whole tenant list", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "t_a") as never);

    const res = await caller.list({ tenantId: "t_a", search: "Анна" });
    const chatIds = res.rows.map((r) => r.chatId).sort();

    // Correct (column-qualified) correlation → only Анна (1001).
    // Pre-fix unqualified SQL → tautology → also returns Борис (1002).
    expect(chatIds).toEqual([1001]);
    expect(res.total).toBe(1);
    // Explicitly assert the non-matching client did NOT leak in.
    expect(chatIds).not.toContain(1002);
  });

  it("never returns a different tenant's matching client", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "t_a") as never);

    const res = await caller.list({ tenantId: "t_a", search: "Анна" });
    const chatIds = res.rows.map((r) => r.chatId);
    // t_decoy's "Анна Декой" (9001) must never surface for a t_a search.
    expect(chatIds).not.toContain(9001);
    for (const r of res.rows) expect(r.tenantId).toBe("t_a");
  });

  it("a search matching nothing returns an empty set (EXISTS not short-circuited to true)", async () => {
    const db = await freshDb();
    const { createCallerFactory } = await import("~/server/api/trpc");
    const { clientsRouter } = await import("~/server/api/routers/clients");
    const caller = createCallerFactory(clientsRouter)(ownerCtx(db, "t_a") as never);

    const res = await caller.list({ tenantId: "t_a", search: "Зинаида" });
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
