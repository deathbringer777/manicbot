/**
 * salonMetrics router — aggregate correctness + tenant isolation (TDD).
 *
 * Exercised against a REAL in-memory libsql DB (the `appointments-tenant-scope`
 * precedent) so WHERE clauses, GROUP BY, SUM, and the (tenant_id, svc_id) join
 * are genuinely enforced — a mock that ignored WHERE would hide a tenant leak.
 *
 * Every test seeds TWO tenants (`t_a`, `t_b`) with overlapping chat_ids and
 * svc_ids; the assertions verify tenant B's rows NEVER appear in tenant A's
 * results, that a wrong-tenant / unauthenticated caller is rejected, and that
 * the revenue definition (SUM(services.price) over cancelled=0 AND no_show=0 in
 * the current month) is pinned exactly.
 *
 * Time unit contract (see schema + Worker writers):
 *   appointments.ts → ms · appointments.createdAt → sec · users.registeredAt → sec
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "1", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { salonMetricsRouter } from "~/server/api/routers/salonMetrics";
import {
  makeTenantOwnerCtx,
  makeUnauthCtx,
} from "./helpers/db-mock";

// Reference instant: 2026-06-06T12:00:00.000Z (Saturday). Current month = June
// 2026; current ISO week = Mon 2026-06-01 .. Sun 2026-06-07.
const NOW_ISO = "2026-06-06T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const NOW_SEC = Math.floor(NOW_MS / 1000);
const DAY_MS = 86_400_000;
const DAY_SEC = 86_400;

const TA = "t_a";
const TB = "t_b";

// ── In-memory schema (canonical DDL, trimmed to the columns the router reads) ──
const DDL_APPOINTMENTS = `CREATE TABLE appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL,
  svc_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, duration INTEGER,
  ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', master_id INTEGER,
  user_name TEXT, user_phone TEXT, user_tg TEXT, confirmed_by INTEGER,
  counter_time TEXT, counter_comment TEXT, reject_comment TEXT, cancel_reason TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0, cancelled_by TEXT, cancelled_at INTEGER,
  no_show INTEGER DEFAULT 0, no_show_by TEXT, rem_h24 INTEGER NOT NULL DEFAULT 0,
  rem_h2 INTEGER NOT NULL DEFAULT 0, google_event_id TEXT, google_calendar_id TEXT,
  google_integration_id TEXT, sync_retries INTEGER DEFAULT 0, sync_retry_after INTEGER,
  sync_last_error TEXT, review_requested INTEGER DEFAULT 0, visit_confirmed_at INTEGER,
  visit_confirmed_by TEXT, review_requested_at INTEGER, followup_24h_sent_at INTEGER,
  created_at INTEGER NOT NULL
)`;
const DDL_SERVICES = `CREATE TABLE services (
  tenant_id TEXT NOT NULL, svc_id TEXT NOT NULL, emoji TEXT, duration INTEGER NOT NULL,
  price REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0, names TEXT, description TEXT, photos TEXT,
  promo TEXT, category TEXT, industry_specific_props TEXT, PRIMARY KEY (tenant_id, svc_id)
)`;
const DDL_USERS = `CREATE TABLE users (
  tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, tg_username TEXT,
  tg_lang TEXT, phone TEXT, registered_at INTEGER, tos_accepted_at INTEGER,
  first_source TEXT, first_campaign TEXT, first_medium TEXT, first_touch_at INTEGER,
  dob TEXT, email TEXT, ig_username TEXT, notes TEXT, tags TEXT, marketing_contact_id INTEGER,
  email_opt_in INTEGER, email_prompt_last_at INTEGER, email_prompt_count INTEGER NOT NULL DEFAULT 0,
  is_blocked_global INTEGER NOT NULL DEFAULT 0, blocked_global_reason TEXT, blocked_global_at INTEGER,
  updated_at INTEGER, deleted_at INTEGER, lifetime_visits INTEGER NOT NULL DEFAULT 0,
  last_visit_at INTEGER, no_show_count INTEGER NOT NULL DEFAULT 0, avatar_emoji TEXT, avatar_url TEXT, avatar_r2_key TEXT,
  favorite_master_id INTEGER, PRIMARY KEY (tenant_id, chat_id)
)`;
const DDL_MASTERS = `CREATE TABLE masters (
  tenant_id TEXT NOT NULL, chat_id INTEGER NOT NULL, name TEXT, tg_username TEXT,
  services TEXT, work_hours TEXT, work_days TEXT, on_vacation INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, added_at INTEGER, google_calendar_id TEXT,
  calendar_enabled INTEGER NOT NULL DEFAULT 0, bio TEXT, photo TEXT, portfolio TEXT,
  allow_delegation INTEGER NOT NULL DEFAULT 0, web_user_id TEXT,
  calendar_visibility TEXT NOT NULL DEFAULT 'salon_only', is_synthetic INTEGER NOT NULL DEFAULT 0,
  public_hidden INTEGER NOT NULL DEFAULT 0, vacation_from INTEGER, vacation_until INTEGER,
  origin TEXT NOT NULL DEFAULT 'salon_created', archived_at INTEGER, telegram_chat_id INTEGER,
  avatar_emoji TEXT, avatar_url TEXT, avatar_r2_key TEXT, PRIMARY KEY (tenant_id, chat_id)
)`;

type Db = ReturnType<typeof drizzle>;

async function freshDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  for (const ddl of [DDL_APPOINTMENTS, DDL_SERVICES, DDL_USERS, DDL_MASTERS]) {
    await client.execute(ddl);
  }
  return drizzle(client, { schema });
}

let aptSeq = 0;
async function seedApt(db: Db, over: Record<string, unknown> = {}) {
  aptSeq += 1;
  await db.insert(schema.appointments).values({
    id: `apt_${aptSeq}`,
    tenantId: TA,
    chatId: 900,
    svcId: "classic",
    date: "2026-06-05",
    time: "12:00",
    ts: NOW_MS,
    status: "confirmed",
    masterId: null,
    cancelled: 0,
    noShow: 0,
    remH24: 0,
    remH2: 0,
    createdAt: NOW_SEC,
    ...over,
  });
}

async function seedService(db: Db, over: Record<string, unknown> = {}) {
  await db.insert(schema.services).values({
    tenantId: TA,
    svcId: "classic",
    emoji: "💅",
    duration: 60,
    price: 100,
    active: 1,
    hidden: 0,
    sortOrder: 0,
    names: JSON.stringify({ ru: "Классика", en: "Classic" }),
    ...over,
  });
}

async function seedUser(db: Db, over: Record<string, unknown> = {}) {
  await db.insert(schema.users).values({
    tenantId: TA,
    chatId: 900,
    name: "Anna",
    registeredAt: NOW_SEC,
    ...over,
  });
}

async function seedMaster(db: Db, over: Record<string, unknown> = {}) {
  await db.insert(schema.masters).values({
    tenantId: TA,
    chatId: 5001,
    name: "Master One",
    ...over,
  });
}

function ownerCaller(db: Db, tenantId = TA) {
  return createCallerFactory(salonMetricsRouter)(makeTenantOwnerCtx(db, tenantId) as never);
}

beforeEach(() => {
  aptSeq = 0;
  // Pin the wall clock the procedures read (`Date.now()` / `new Date()` →
  // current month/week/period) WITHOUT vi.useFakeTimers(), which would freeze
  // the async timers @libsql/client relies on and deadlock every query.
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth / tenant-isolation guard (applies to every procedure)
// ─────────────────────────────────────────────────────────────────────────────
describe("salonMetrics — auth guard", () => {
  it("rejects an unauthenticated caller", async () => {
    const db = await freshDb();
    const caller = createCallerFactory(salonMetricsRouter)(makeUnauthCtx(db) as never);
    await expect(caller.getKpiSummary({ tenantId: TA, period: "30d" })).rejects.toMatchObject({
      code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
    });
  });

  it("rejects an owner of a DIFFERENT tenant on every procedure", async () => {
    const db = await freshDb();
    // Caller is owner of t_b, asking about t_a → assertTenantOwner must FORBID.
    const caller = ownerCaller(db, TB);
    await expect(caller.getKpiSummary({ tenantId: TA, period: "30d" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getDailyCounts({ tenantId: TA, days: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getTopServices({ tenantId: TA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getTopMasters({ tenantId: TA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.getRecentActivity({ tenantId: TA })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getKpiSummary
// ─────────────────────────────────────────────────────────────────────────────
describe("salonMetrics.getKpiSummary", () => {
  it("counts total + new clients scoped to the tenant", async () => {
    const db = await freshDb();
    // t_a: one old client, one new (within 30d). t_b: a client that must NOT count.
    await seedUser(db, { chatId: 900, registeredAt: NOW_SEC - 200 * DAY_SEC }); // old
    await seedUser(db, { chatId: 901, registeredAt: NOW_SEC - 5 * DAY_SEC }); // new
    await seedUser(db, { tenantId: TB, chatId: 900, registeredAt: NOW_SEC }); // other tenant

    const r = await ownerCaller(db).getKpiSummary({ tenantId: TA, period: "30d" });
    expect(r.totalClients).toBe(2);
    expect(r.newClients).toBe(1); // only the one registered within 30d
    expect(r.period).toBe("30d");
  });

  it("weekAppointments counts current-week non-cancelled only, tenant-scoped", async () => {
    const db = await freshDb();
    await seedApt(db, { date: "2026-06-03", ts: NOW_MS - 2 * DAY_MS }); // in week
    await seedApt(db, { date: "2026-06-05", ts: NOW_MS - 1 * DAY_MS, cancelled: 1 }); // cancelled → excluded
    await seedApt(db, { date: "2026-05-20", ts: NOW_MS - 17 * DAY_MS }); // last week → excluded
    await seedApt(db, { tenantId: TB, date: "2026-06-03", ts: NOW_MS - 2 * DAY_MS }); // other tenant

    const r = await ownerCaller(db).getKpiSummary({ tenantId: TA, period: "30d" });
    expect(r.weekAppointments).toBe(1);
  });

  it("doneCount counts status='done' for the tenant", async () => {
    const db = await freshDb();
    await seedApt(db, { status: "done" });
    await seedApt(db, { status: "done" });
    await seedApt(db, { status: "confirmed" });
    await seedApt(db, { tenantId: TB, status: "done" }); // other tenant
    const r = await ownerCaller(db).getKpiSummary({ tenantId: TA, period: "30d" });
    expect(r.doneCount).toBe(2);
  });

  it("REVENUE = SUM(services.price) over cancelled=0 AND no_show=0 in the CURRENT MONTH", async () => {
    const db = await freshDb();
    await seedService(db, { svcId: "classic", price: 100 });
    await seedService(db, { svcId: "lux", price: 250 });
    // Counted: two valid June appointments → 100 + 250 = 350.
    await seedApt(db, { svcId: "classic", date: "2026-06-02", ts: Date.parse("2026-06-02T10:00:00Z") });
    await seedApt(db, { svcId: "lux", date: "2026-06-04", ts: Date.parse("2026-06-04T10:00:00Z") });
    // Excluded: cancelled, no-show, and a previous-month booking.
    await seedApt(db, { svcId: "lux", date: "2026-06-04", ts: Date.parse("2026-06-04T11:00:00Z"), cancelled: 1 });
    await seedApt(db, { svcId: "lux", date: "2026-06-04", ts: Date.parse("2026-06-04T12:00:00Z"), noShow: 1 });
    await seedApt(db, { svcId: "lux", date: "2026-05-30", ts: Date.parse("2026-05-30T10:00:00Z") });
    // Excluded: other tenant.
    await seedService(db, { tenantId: TB, svcId: "classic", price: 9999 });
    await seedApt(db, { tenantId: TB, svcId: "classic", date: "2026-06-02", ts: Date.parse("2026-06-02T10:00:00Z") });

    const r = await ownerCaller(db).getKpiSummary({ tenantId: TA, period: "30d" });
    expect(r.monthRevenue).toBe(350);
  });

  it("noShowRate is the no-show fraction (0..1) over the period's finished-or-noshow appointments", async () => {
    const db = await freshDb();
    // Within 30d period: 1 no-show + 3 non-cancelled non-no-show → 1/4 = 0.25.
    await seedApt(db, { ts: NOW_MS - 1 * DAY_MS, noShow: 1, status: "no_show" });
    await seedApt(db, { ts: NOW_MS - 2 * DAY_MS });
    await seedApt(db, { ts: NOW_MS - 3 * DAY_MS });
    await seedApt(db, { ts: NOW_MS - 4 * DAY_MS, status: "done" });
    // Cancelled rows are NOT in the denominator.
    await seedApt(db, { ts: NOW_MS - 5 * DAY_MS, cancelled: 1 });
    const r = await ownerCaller(db).getKpiSummary({ tenantId: TA, period: "30d" });
    expect(r.noShowRate).toBeCloseTo(0.25, 5);
  });

  it("noShowRate is 0 (not NaN) when there are no appointments", async () => {
    const db = await freshDb();
    const r = await ownerCaller(db).getKpiSummary({ tenantId: TA, period: "30d" });
    expect(r.noShowRate).toBe(0);
    expect(r.monthRevenue).toBe(0);
    expect(r.totalClients).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getDailyCounts
// ─────────────────────────────────────────────────────────────────────────────
describe("salonMetrics.getDailyCounts", () => {
  it("returns one row per day with gaps filled to 0, tenant-scoped", async () => {
    const db = await freshDb();
    await seedApt(db, { date: "2026-06-06", ts: NOW_MS });
    await seedApt(db, { date: "2026-06-06", ts: NOW_MS - 3600_000 });
    await seedApt(db, { date: "2026-06-04", ts: NOW_MS - 2 * DAY_MS });
    await seedApt(db, { tenantId: TB, date: "2026-06-05", ts: NOW_MS - DAY_MS }); // other tenant → excluded

    const r = await ownerCaller(db).getDailyCounts({ tenantId: TA, days: 3 });
    expect(r).toEqual([
      { date: "2026-06-04", appointments: 1 },
      { date: "2026-06-05", appointments: 0 }, // gap filled
      { date: "2026-06-06", appointments: 2 },
    ]);
  });

  it("excludes cancelled appointments from daily counts", async () => {
    const db = await freshDb();
    await seedApt(db, { date: "2026-06-06", ts: NOW_MS });
    await seedApt(db, { date: "2026-06-06", ts: NOW_MS, cancelled: 1 });
    const r = await ownerCaller(db).getDailyCounts({ tenantId: TA, days: 1 });
    expect(r).toEqual([{ date: "2026-06-06", appointments: 1 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTopServices
// ─────────────────────────────────────────────────────────────────────────────
describe("salonMetrics.getTopServices", () => {
  it("ranks services by bookings with revenue, name + emoji resolved, tenant-scoped", async () => {
    const db = await freshDb();
    await seedService(db, { svcId: "classic", price: 100, emoji: "💅", names: JSON.stringify({ ru: "Классика" }) });
    await seedService(db, { svcId: "lux", price: 250, emoji: "✨", names: JSON.stringify({ ru: "Люкс" }) });
    // classic: 2 bookings (within 30d) → revenue 200. lux: 1 booking → 250.
    await seedApt(db, { svcId: "classic", ts: NOW_MS - DAY_MS });
    await seedApt(db, { svcId: "classic", ts: NOW_MS - 2 * DAY_MS });
    await seedApt(db, { svcId: "lux", ts: NOW_MS - 3 * DAY_MS });
    // other tenant with same svc_id must not bleed in
    await seedService(db, { tenantId: TB, svcId: "classic", price: 1, emoji: "❌" });
    await seedApt(db, { tenantId: TB, svcId: "classic", ts: NOW_MS - DAY_MS });

    const r = await ownerCaller(db).getTopServices({ tenantId: TA, period: "30d" });
    expect(r).toHaveLength(2);
    const classic = r.find((s) => s.svcId === "classic")!;
    expect(classic).toMatchObject({ name: "Классика", emoji: "💅", bookings: 2, revenue: 200 });
    expect(r.find((s) => s.svcId === "lux")).toMatchObject({ bookings: 1, revenue: 250 });
    // Ranked: classic (2) before lux (1)
    expect(r[0]!.svcId).toBe("classic");
  });

  it("honours the limit", async () => {
    const db = await freshDb();
    await seedService(db, { svcId: "a", price: 10 });
    await seedService(db, { svcId: "b", price: 20 });
    await seedApt(db, { svcId: "a", ts: NOW_MS - DAY_MS });
    await seedApt(db, { svcId: "a", ts: NOW_MS - DAY_MS });
    await seedApt(db, { svcId: "b", ts: NOW_MS - DAY_MS });
    const r = await ownerCaller(db).getTopServices({ tenantId: TA, period: "30d", limit: 1 });
    expect(r).toHaveLength(1);
    expect(r[0]!.svcId).toBe("a");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getTopMasters
// ─────────────────────────────────────────────────────────────────────────────
describe("salonMetrics.getTopMasters", () => {
  it("ranks masters by bookings with revenue, masterId mapped to String(chatId), tenant-scoped", async () => {
    const db = await freshDb();
    await seedService(db, { svcId: "classic", price: 100 });
    await seedMaster(db, { chatId: 5001, name: "Alpha" });
    await seedMaster(db, { chatId: 5002, name: "Beta" });
    // Alpha: 2 bookings → 200. Beta: 1 booking → 100.
    await seedApt(db, { masterId: 5001, svcId: "classic", ts: NOW_MS - DAY_MS });
    await seedApt(db, { masterId: 5001, svcId: "classic", ts: NOW_MS - 2 * DAY_MS });
    await seedApt(db, { masterId: 5002, svcId: "classic", ts: NOW_MS - 3 * DAY_MS });
    // other tenant master with same chat_id must not appear
    await seedMaster(db, { tenantId: TB, chatId: 5001, name: "Ghost" });
    await seedApt(db, { tenantId: TB, masterId: 5001, svcId: "classic", ts: NOW_MS - DAY_MS });

    const r = await ownerCaller(db).getTopMasters({ tenantId: TA, period: "30d" });
    const alpha = r.find((m) => m.masterId === "5001")!;
    expect(typeof alpha.masterId).toBe("string");
    expect(alpha).toMatchObject({ name: "Alpha", bookings: 2, revenue: 200 });
    expect(r.find((m) => m.masterId === "5002")).toMatchObject({ name: "Beta", bookings: 1 });
    expect(r.every((m) => m.name !== "Ghost")).toBe(true);
  });

  it("ignores appointments with a null master_id", async () => {
    const db = await freshDb();
    await seedService(db, { svcId: "classic", price: 100 });
    await seedMaster(db, { chatId: 5001, name: "Alpha" });
    await seedApt(db, { masterId: null, svcId: "classic", ts: NOW_MS - DAY_MS });
    await seedApt(db, { masterId: 5001, svcId: "classic", ts: NOW_MS - DAY_MS });
    const r = await ownerCaller(db).getTopMasters({ tenantId: TA, period: "30d" });
    expect(r).toHaveLength(1);
    expect(r[0]!.masterId).toBe("5001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRecentActivity
// ─────────────────────────────────────────────────────────────────────────────
describe("salonMetrics.getRecentActivity", () => {
  it("returns recent bookings newest-first, name resolved, kind='booking', tenant-scoped", async () => {
    const db = await freshDb();
    await seedUser(db, { chatId: 900, name: "Resolved Anna" });
    // Newer (no snapshot name → resolved from users) + older (snapshot wins).
    await seedApt(db, { id: "apt_new", chatId: 900, userName: null, createdAt: NOW_SEC, status: "confirmed" });
    await seedApt(db, { id: "apt_old", chatId: 901, userName: "Snapshot Bob", createdAt: NOW_SEC - 100, status: "done" });
    await seedApt(db, { tenantId: TB, chatId: 900, userName: "Leak", createdAt: NOW_SEC + 50 }); // other tenant

    const r = await ownerCaller(db).getRecentActivity({ tenantId: TA, limit: 10 });
    expect(r.map((a) => a.id)).toEqual(["apt_new", "apt_old"]); // newest first
    expect(r[0]).toMatchObject({ name: "Resolved Anna", kind: "booking", status: "confirmed" });
    expect(r[0]!.ts).toBe(NOW_SEC); // createdAt is seconds, mirrored on ts
    expect(r[1]).toMatchObject({ name: "Snapshot Bob", status: "done" });
    expect(r.some((a) => a.name === "Leak")).toBe(false);
  });

  it("honours the limit (newest N)", async () => {
    const db = await freshDb();
    await seedApt(db, { id: "a1", createdAt: NOW_SEC - 30, userName: "One" });
    await seedApt(db, { id: "a2", createdAt: NOW_SEC - 20, userName: "Two" });
    await seedApt(db, { id: "a3", createdAt: NOW_SEC - 10, userName: "Three" });
    const r = await ownerCaller(db).getRecentActivity({ tenantId: TA, limit: 2 });
    expect(r.map((a) => a.id)).toEqual(["a3", "a2"]);
  });
});
