/**
 * appointments.claimAndConfirm — claim-first confirmation from the "Заявки"
 * inbox, exercised against REAL Drizzle SQL on in-memory libsql so the atomic
 * UPDATE guard is genuinely tested (a mock that ignores the WHERE clause would
 * pass a broken guard).
 *
 * Guarantees under test:
 *   1. A master claims an unassigned pending request → status=confirmed,
 *      master_id = caller's chatId, confirmed_by = caller.
 *   2. Concurrency: two masters racing the same unassigned request → exactly
 *      one wins, the other gets { ok:false, reason:'already_taken' } (the
 *      `WHERE master_id IS NULL AND status='pending'` guard is the arbiter).
 *   3. A master may confirm a request already assigned to THEMSELVES, but NOT
 *      one assigned to a different master.
 *   4. Tenant isolation: a request in another tenant is never claimable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "1", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));
vi.mock("~/server/api/tenantAccess", () => ({
  assertTenantOwner: vi.fn(async () => undefined),
}));
const notifyWorker = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("~/server/utils/notifyWorker", () => ({ notifyWorker: (...a: unknown[]) => notifyWorker(...a) }));

const TENANT = "t_claim";
const NOW = 1_780_000_000;

const BOOTSTRAP_SQL = [
  `CREATE TABLE appointments (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     chat_id INTEGER NOT NULL,
     svc_id TEXT NOT NULL,
     date TEXT NOT NULL,
     time TEXT NOT NULL,
     ts INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     master_id INTEGER,
     user_name TEXT,
     user_phone TEXT,
     user_tg TEXT,
     confirmed_by INTEGER,
     counter_time TEXT,
     counter_comment TEXT,
     reject_comment TEXT,
     cancel_reason TEXT,
     cancelled INTEGER NOT NULL DEFAULT 0,
     cancelled_by TEXT,
     cancelled_at INTEGER,
     no_show INTEGER DEFAULT 0,
     no_show_by TEXT,
     rem_h24 INTEGER NOT NULL DEFAULT 0,
     rem_h2 INTEGER NOT NULL DEFAULT 0,
     google_event_id TEXT,
     google_calendar_id TEXT,
     google_integration_id TEXT,
     sync_retries INTEGER DEFAULT 0,
     sync_retry_after INTEGER,
     sync_last_error TEXT,
     review_requested INTEGER DEFAULT 0,
     visit_confirmed_at INTEGER,
     visit_confirmed_by TEXT,
     review_requested_at INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE masters (
     tenant_id TEXT NOT NULL,
     chat_id INTEGER NOT NULL,
     name TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     web_user_id TEXT,
     archived_at INTEGER,
     PRIMARY KEY (tenant_id, chat_id)
   )`,
];

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  for (const stmt of BOOTSTRAP_SQL) await client.execute(stmt);
  const db = drizzle(client, { schema });
  // Two salon masters with linked web accounts.
  await client.execute({
    sql: "INSERT INTO masters (tenant_id, chat_id, name, active, web_user_id) VALUES (?,?,?,?,?)",
    args: [TENANT, 111, "Anna", 1, "wu_anna"],
  });
  await client.execute({
    sql: "INSERT INTO masters (tenant_id, chat_id, name, active, web_user_id) VALUES (?,?,?,?,?)",
    args: [TENANT, 222, "Bea", 1, "wu_bea"],
  });
  return db;
}

async function seedApt(db: ReturnType<typeof drizzle>, over: Record<string, unknown> = {}) {
  await db.insert(schema.appointments).values({
    id: "apt_1", tenantId: TENANT, chatId: 900, svcId: "classic",
    date: "2026-06-01", time: "12:00", ts: NOW, status: "pending",
    masterId: null, cancelled: 0, noShow: 0, remH24: 0, remH2: 0, createdAt: NOW,
    ...over,
  });
}

function masterCtx(db: ReturnType<typeof drizzle>, webUserId: string) {
  return {
    headers: new Headers(),
    webUser: { id: webUserId, email: `${webUserId}@x.io`, tenantId: TENANT, webRole: "master" },
    db,
  } as unknown;
}

async function caller(ctx: unknown) {
  const { createCallerFactory } = await import("~/server/api/trpc");
  const { appointmentsRouter } = await import("~/server/api/routers/appointments");
  return createCallerFactory(appointmentsRouter)(ctx as never);
}

describe("appointments.claimAndConfirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a master claims an unassigned pending request", async () => {
    const db = await freshDb();
    await seedApt(db);
    const c = await caller(masterCtx(db, "wu_anna"));
    const res = await c.claimAndConfirm({ tenantId: TENANT, id: "apt_1" });
    expect(res.ok).toBe(true);

    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.status).toBe("confirmed");
    expect(row!.masterId).toBe(111);
    expect(row!.confirmedBy).toBe(111);
    expect(notifyWorker).toHaveBeenCalledOnce();
  });

  it("concurrency: two masters race → exactly one wins", async () => {
    const db = await freshDb();
    await seedApt(db);
    const a = await caller(masterCtx(db, "wu_anna"));
    const b = await caller(masterCtx(db, "wu_bea"));
    const [ra, rb] = await Promise.all([
      a.claimAndConfirm({ tenantId: TENANT, id: "apt_1" }),
      b.claimAndConfirm({ tenantId: TENANT, id: "apt_1" }),
    ]);
    const wins = [ra, rb].filter((r) => r.ok).length;
    const taken = [ra, rb].filter((r) => !r.ok && r.reason === "already_taken").length;
    expect(wins).toBe(1);
    expect(taken).toBe(1);

    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.status).toBe("confirmed");
    expect([111, 222]).toContain(row!.masterId);
  });

  it("a master can confirm a request already assigned to themselves", async () => {
    const db = await freshDb();
    await seedApt(db, { masterId: 111 });
    const c = await caller(masterCtx(db, "wu_anna"));
    const res = await c.claimAndConfirm({ tenantId: TENANT, id: "apt_1" });
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.status).toBe("confirmed");
    expect(row!.masterId).toBe(111);
  });

  it("a master canNOT confirm a request assigned to a DIFFERENT master", async () => {
    const db = await freshDb();
    await seedApt(db, { masterId: 222 }); // assigned to Bea
    const c = await caller(masterCtx(db, "wu_anna")); // Anna tries
    const res = await c.claimAndConfirm({ tenantId: TENANT, id: "apt_1" });
    expect(res.ok).toBe(false);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.status).toBe("pending");
    expect(row!.masterId).toBe(222);
  });

  it("rejects a caller who is not a master in this tenant", async () => {
    const db = await freshDb();
    await seedApt(db);
    const c = await caller(masterCtx(db, "wu_ghost")); // no masters row
    await expect(c.claimAndConfirm({ tenantId: TENANT, id: "apt_1" })).rejects.toThrow(
      "not_a_master_in_tenant",
    );
  });

  it("does not claim a request in a different tenant", async () => {
    const db = await freshDb();
    await seedApt(db, { tenantId: "t_other" });
    const c = await caller(masterCtx(db, "wu_anna"));
    const res = await c.claimAndConfirm({ tenantId: TENANT, id: "apt_1" });
    expect(res.ok).toBe(false); // not found within TENANT → already_taken
  });
});
