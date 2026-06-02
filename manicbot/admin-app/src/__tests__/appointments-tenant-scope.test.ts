/**
 * appointments.updateStatus / markNoShow are God Mode (adminProcedure =
 * system_admin). Per CLAUDE.md, God Mode operates ON a tenant from an EXPLICIT
 * input.tenantId, never inferred — so the write MUST be scoped by tenant_id.
 * A7: a wrong-tenant id must be a no-op. Exercised against real Drizzle/libsql
 * so the WHERE clause is genuinely enforced (a mock ignoring WHERE would pass a
 * broken guard).
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
const notifyWorker = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("~/server/utils/notifyWorker", () => ({ notifyWorker: (...a: unknown[]) => notifyWorker(...a) }));

const NOW = 1_780_000_000;

const BOOTSTRAP_SQL = `CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  svc_id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration INTEGER,
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
)`;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute(BOOTSTRAP_SQL);
  return drizzle(client, { schema });
}

async function seedApt(db: ReturnType<typeof drizzle>, over: Record<string, unknown> = {}) {
  await db.insert(schema.appointments).values({
    id: "apt_1", tenantId: "t_a", chatId: 900, svcId: "classic",
    date: "2026-06-01", time: "12:00", ts: NOW, status: "pending",
    masterId: null, cancelled: 0, noShow: 0, remH24: 0, remH2: 0, createdAt: NOW,
    ...over,
  });
}

function adminCtx(db: ReturnType<typeof drizzle>) {
  return {
    headers: new Headers(),
    webUser: { id: "wu_admin", email: "admin@x.io", tenantId: "t_a", webRole: "system_admin" },
    db,
  } as unknown;
}

async function caller(ctx: unknown) {
  const { createCallerFactory } = await import("~/server/api/trpc");
  const { appointmentsRouter } = await import("~/server/api/routers/appointments");
  return createCallerFactory(appointmentsRouter)(ctx as never);
}

describe("appointments God Mode mutations — tenant scoping (A7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updateStatus applies when tenantId matches the row", async () => {
    const db = await freshDb();
    await seedApt(db);
    const c = await caller(adminCtx(db));
    const res = await c.updateStatus({ tenantId: "t_a", id: "apt_1", status: "confirmed" });
    expect(res.success).toBe(true);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.status).toBe("confirmed");
  });

  it("updateStatus is a no-op for a wrong-tenant id (A7)", async () => {
    const db = await freshDb();
    await seedApt(db); // row belongs to t_a
    const c = await caller(adminCtx(db));
    const res = await c.updateStatus({ tenantId: "t_other", id: "apt_1", status: "cancelled" });
    expect(res.success).toBe(false);
    const [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    // Untouched — not cancelled, no Worker notification fired.
    expect(row!.status).toBe("pending");
    expect(row!.cancelled).toBe(0);
    expect(notifyWorker).not.toHaveBeenCalled();
  });

  it("markNoShow only mutates within the asserted tenant (A7)", async () => {
    const db = await freshDb();
    await seedApt(db, { status: "confirmed" });
    const c = await caller(adminCtx(db));

    const bad = await c.markNoShow({ tenantId: "t_other", id: "apt_1", noShowBy: "client" });
    expect(bad.success).toBe(false);
    let [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.noShow).toBe(0);

    const ok = await c.markNoShow({ tenantId: "t_a", id: "apt_1", noShowBy: "client" });
    expect(ok.success).toBe(true);
    [row] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, "apt_1"));
    expect(row!.noShow).toBe(1);
    expect(row!.status).toBe("no_show");
  });
});
