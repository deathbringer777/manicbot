/**
 * metrics.getChartData — date-window bound is MILLISECONDS (M4).
 *
 * Bug: the procedure computed `since = floor(Date.now()/1000) - days*86400`
 * (SECONDS) and filtered `gte(appointments.ts, since)` where `appointments.ts`
 * is epoch MILLISECONDS. Every real `ts` (~1.7e12) dwarfs a seconds bound
 * (~1.7e9), so the WHERE was a no-op: the query ignored the `days` window and
 * full-scanned every appointment ever instead of bounding the scan.
 *
 * Contract (mirrors salonMetrics.getDailyCounts): the WHERE actually bounds the
 * scan to the last `days` days using a millisecond bound, so an appointment
 * whose `ts` is OLDER than the window is excluded at the SQL layer, while one
 * INSIDE the window is counted.
 *
 * Exercised against a REAL in-memory libsql DB (the salonMetrics precedent) so a
 * mock that ignores WHERE can't hide the ms/sec defect. Dates are derived from
 * the REAL wall clock because getChartData's gap-fill uses `new Date()` (real
 * clock) while the SQL bound uses `Date.now()` — we keep both consistent by not
 * faking time and computing the seed rows relative to "now".
 */
import { describe, it, expect, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "~/server/db/schema";

vi.mock("~/server/db", () => ({ getDb: () => null }));
vi.mock("~/env", () => ({
  env: { ADMIN_CHAT_ID: "1", AUTH_SECRET: "test", TELEGRAM_BOT_TOKEN: "0:TEST" },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { metricsRouter } from "~/server/api/routers/metrics";
import { makeAdminCtx } from "./helpers/db-mock";

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for `now - daysAgo` in the SAME (UTC) calendar getChartData uses. */
function dayKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0]!;
}

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

type Db = ReturnType<typeof drizzle>;

async function freshDb(): Promise<Db> {
  const client = createClient({ url: ":memory:" });
  await client.execute(DDL_APPOINTMENTS);
  return drizzle(client, { schema });
}

let aptSeq = 0;
async function seedApt(db: Db, over: Record<string, unknown> = {}) {
  aptSeq += 1;
  await db.insert(schema.appointments).values({
    id: `apt_${aptSeq}`,
    tenantId: "t_a",
    chatId: 900,
    svcId: "classic",
    date: dayKey(1),
    time: "12:00",
    ts: Date.now() - DAY_MS,
    status: "confirmed",
    cancelled: 0,
    noShow: 0,
    remH24: 0,
    remH2: 0,
    createdAt: Math.floor(Date.now() / 1000),
    ...over,
  });
}

function adminCaller(db: Db) {
  return createCallerFactory(metricsRouter)(makeAdminCtx(db) as never);
}

describe("metrics.getChartData — millisecond window bound", () => {
  it("excludes a row whose ts is older than the ms window even when its date key is in-range", async () => {
    aptSeq = 0;
    const db = await freshDb();
    // Genuinely in-window booking: ts AND date both inside the 7-day window.
    await seedApt(db, { date: dayKey(1), ts: Date.now() - 1 * DAY_MS });
    // Discriminating row: its `date` key (2 days ago) lands inside the gap-fill
    // window so the in-JS step would happily bucket it, BUT its `ts` is 40 days
    // old — OLDER than the ms window bound. A CORRECT ms `gte(ts, sinceMs)`
    // drops it at the SQL layer. The buggy SECONDS bound (~1.7e9) is dwarfed by
    // any real ms ts (~1.7e12), so the buggy filter lets it through and the
    // count for that day becomes 1 → test goes red.
    await seedApt(db, { date: dayKey(2), ts: Date.now() - 40 * DAY_MS });

    const data = await adminCaller(db).getChartData({ days: 7 });

    expect(data).toHaveLength(7); // 7 day-buckets, gaps filled with 0
    const total = data.reduce((sum, d) => sum + d.appointments, 0);
    expect(total).toBe(1); // only the in-window row survives the ms bound
    expect(data.find((d) => d.date === dayKey(1))?.appointments).toBe(1);
    expect(data.find((d) => d.date === dayKey(2))?.appointments).toBe(0);
  });

  it("excludes cancelled appointments inside the window", async () => {
    aptSeq = 0;
    const db = await freshDb();
    await seedApt(db, { date: dayKey(1), ts: Date.now() - 1 * DAY_MS });
    await seedApt(db, { date: dayKey(1), ts: Date.now() - 1 * DAY_MS, cancelled: 1 });

    const data = await adminCaller(db).getChartData({ days: 7 });
    expect(data.find((d) => d.date === dayKey(1))?.appointments).toBe(1);
  });
});
