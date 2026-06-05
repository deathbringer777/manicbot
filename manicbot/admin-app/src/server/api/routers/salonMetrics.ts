/**
 * salonMetrics — tenant-scoped aggregate metrics for the configurable "Домой"
 * (overview) widget board (KPI blocks, calendar heatmap, top services/masters,
 * activity feed).
 *
 * The procedure SIGNATURES, input schemas, and exported return TYPES below are
 * the FROZEN CONTRACT that the widget board + settings build against. `root.ts`
 * already registers this router.
 *
 * Invariants:
 *   - Every procedure: `tenantOwnerProcedure` + `await assertTenantOwner(...)`.
 *   - EVERY query WHERE includes `eq(table.tenantId, input.tenantId)` (tenant
 *     isolation — cross-tenant leakage is covered per procedure in the tests).
 *   - Revenue = SUM(services.price) over appointments with `cancelled = 0 AND
 *     noShow = 0` in the CURRENT MONTH (excludes cancels + no-shows).
 *   - Mirrors the `Promise.all` aggregate style of `salon.getOverview` /
 *     `appointments.getStats`; reuses `appointmentNameColumns` /
 *     `foldAppointmentNames` for activity client names.
 *
 * TIME-UNIT CONTRACT (verified against the Worker writers + schema comments):
 *   - `appointments.ts`        → epoch MILLISECONDS (Date.now()) — used for all
 *                                 rolling-window / month / week filters.
 *   - `appointments.createdAt` → epoch SECONDS (nowSec())        — activity ts.
 *   - `users.registeredAt`     → epoch SECONDS (nowSec())        — new clients.
 * The pure helpers below take an injectable `nowMs` so their boundaries are
 * unit-testable without touching the wall clock.
 */
import { z } from "zod";
import { and, eq, gte, desc, sql, getTableColumns } from "drizzle-orm";
import { createTRPCRouter, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { appointments, services, users, masters } from "~/server/db/schema";
import { appointmentNameColumns, foldAppointmentNames } from "~/server/api/appointmentNames";
import { parseServiceName } from "~/lib/serviceName";

/** Rolling window selector shared by the period-scoped procedures. */
export type MetricsPeriod = "7d" | "30d" | "90d";

export interface KpiSummary {
  totalClients: number;
  newClients: number;
  weekAppointments: number;
  monthRevenue: number;
  /** No-show share as a 0..1 fraction (UI renders as a percentage). */
  noShowRate: number;
  doneCount: number;
  period: MetricsPeriod;
}

export interface DailyCount {
  /** Local "YYYY-MM-DD". Gaps in the range are filled with 0. */
  date: string;
  appointments: number;
}

export interface TopService {
  svcId: string;
  name: string;
  emoji: string;
  bookings: number;
  revenue: number;
}

export interface TopMaster {
  masterId: string;
  name: string;
  bookings: number;
  revenue: number;
}

export interface ActivityItem {
  id: string;
  name: string;
  kind: string;
  status: string;
  /** Epoch (matches the source row's timestamp unit). */
  ts: number;
}

const tenantIdSchema = z.string().min(1);
const periodSchema = z.enum(["7d", "30d", "90d"]);

const DAY_MS = 86_400_000;

/** Day-count for each rolling window. */
export const PERIOD_DAYS: Record<MetricsPeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** Resolved bounds for a rolling window, in both ms and seconds + ISO dates. */
export interface MetricsRange {
  fromMs: number;
  toMs: number;
  fromSec: number;
  toSec: number;
  fromISO: string;
  toISO: string;
}

/** UTC "YYYY-MM-DD" for an epoch-ms instant. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Map a rolling period to a concrete `[now - Nd, now]` range. Pure in `nowMs`
 * (default `Date.now()`), so the procedures stay deterministic under test.
 */
export function periodToRange(period: MetricsPeriod, nowMs: number = Date.now()): MetricsRange {
  const fromMs = nowMs - PERIOD_DAYS[period] * DAY_MS;
  return {
    fromMs,
    toMs: nowMs,
    fromSec: Math.floor(fromMs / 1000),
    toSec: Math.floor(nowMs / 1000),
    fromISO: isoDate(fromMs),
    toISO: isoDate(nowMs),
  };
}

/** 00:00:00.000 UTC on the 1st of `nowMs`'s month, as epoch ms. */
export function startOfCurrentMonthMs(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

/**
 * 00:00:00.000 UTC on Monday of `nowMs`'s ISO week, as epoch ms. ISO weeks
 * start Monday; Sunday is the last day (getUTCDay()===0 → 6 days back).
 */
export function startOfCurrentWeekMs(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon→0, Sun→6
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  return midnight - daysSinceMonday * DAY_MS;
}

export interface DailyRange {
  /** Consecutive "YYYY-MM-DD" dates, oldest→newest, inclusive of today. */
  dates: string[];
  /** 00:00 UTC of the earliest day (for the `ts` window filter), epoch ms. */
  fromMs: number;
}

/** The last `days` calendar dates ending today (inclusive), + the ms lower bound. */
export function dailyRange(days: number, nowMs: number = Date.now()): DailyRange {
  const today = new Date(nowMs);
  const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0);
  const fromMs = todayMidnight - (days - 1) * DAY_MS;
  const dates: string[] = [];
  for (let i = 0; i < days; i += 1) {
    dates.push(isoDate(fromMs + i * DAY_MS));
  }
  return { dates, fromMs };
}

/**
 * Project a sparse date→count map onto the dense requested range, filling
 * gaps with 0 and dropping any stray dates outside the range.
 */
export function fillDailyGaps(dates: string[], counts: Map<string, number>): DailyCount[] {
  return dates.map((date) => ({ date, appointments: counts.get(date) ?? 0 }));
}

const DONE_STATUS = "done";

export const salonMetricsRouter = createTRPCRouter({
  getKpiSummary: tenantOwnerProcedure
    .input(z.object({ tenantId: tenantIdSchema, period: periodSchema.default("30d") }))
    .query(async ({ ctx, input }): Promise<KpiSummary> => {
      await assertTenantOwner(ctx, input.tenantId);

      const now = Date.now();
      const range = periodToRange(input.period, now);
      const monthStartMs = startOfCurrentMonthMs(now);
      const weekStartMs = startOfCurrentWeekMs(now);
      const tenantScope = eq(appointments.tenantId, input.tenantId);

      const [
        totalClientsRow,
        newClientsRow,
        weekRow,
        revenueRow,
        doneRow,
        noShowRow,
        periodTotalRow,
      ] = await Promise.all([
        // totalClients — all (non-deleted) clients for the tenant.
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.tenantId, input.tenantId), sql`${users.deletedAt} is null`)),
        // newClients — first registered within the rolling period (seconds col).
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(and(
            eq(users.tenantId, input.tenantId),
            sql`${users.deletedAt} is null`,
            gte(users.registeredAt, range.fromSec),
          )),
        // weekAppointments — current ISO week, non-cancelled (ts is ms).
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(tenantScope, eq(appointments.cancelled, 0), gte(appointments.ts, weekStartMs))),
        // monthRevenue — SUM(services.price) over valid appointments this month.
        // INNER JOIN on the (tenant_id, svc_id) PK keeps it 1:1 (no row blow-up).
        ctx.db
          .select({ total: sql<number>`coalesce(sum(${services.price}), 0)` })
          .from(appointments)
          .innerJoin(
            services,
            and(eq(services.tenantId, appointments.tenantId), eq(services.svcId, appointments.svcId)),
          )
          .where(and(
            tenantScope,
            eq(appointments.cancelled, 0),
            eq(appointments.noShow, 0),
            gte(appointments.ts, monthStartMs),
          )),
        // doneCount — status='done' for the tenant.
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(tenantScope, eq(appointments.status, DONE_STATUS))),
        // noShow numerator — no-shows within the period.
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(tenantScope, eq(appointments.noShow, 1), gte(appointments.ts, range.fromMs))),
        // noShow denominator — completed-or-no-show within the period (i.e.
        // non-cancelled). Cancellations don't count against the show-up rate.
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(tenantScope, eq(appointments.cancelled, 0), gte(appointments.ts, range.fromMs))),
      ]);

      const noShowNum = Number(noShowRow[0]?.count ?? 0);
      const periodTotal = Number(periodTotalRow[0]?.count ?? 0);

      return {
        totalClients: Number(totalClientsRow[0]?.count ?? 0),
        newClients: Number(newClientsRow[0]?.count ?? 0),
        weekAppointments: Number(weekRow[0]?.count ?? 0),
        monthRevenue: Number(revenueRow[0]?.total ?? 0),
        noShowRate: periodTotal > 0 ? noShowNum / periodTotal : 0,
        doneCount: Number(doneRow[0]?.count ?? 0),
        period: input.period,
      };
    }),

  getDailyCounts: tenantOwnerProcedure
    .input(z.object({ tenantId: tenantIdSchema, days: z.number().int().min(1).max(366).default(30) }))
    .query(async ({ ctx, input }): Promise<DailyCount[]> => {
      await assertTenantOwner(ctx, input.tenantId);

      const { dates, fromMs } = dailyRange(input.days, Date.now());
      const rows = await ctx.db
        .select({ date: appointments.date, count: sql<number>`count(*)` })
        .from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.cancelled, 0),
          gte(appointments.ts, fromMs),
        ))
        .groupBy(appointments.date);

      const counts = new Map<string, number>(rows.map((r) => [r.date, Number(r.count)]));
      return fillDailyGaps(dates, counts);
    }),

  getTopServices: tenantOwnerProcedure
    .input(
      z.object({
        tenantId: tenantIdSchema,
        period: periodSchema.default("30d"),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<TopService[]> => {
      await assertTenantOwner(ctx, input.tenantId);

      const range = periodToRange(input.period, Date.now());
      const limit = input.limit ?? 5;

      // Group bookings by service over the period; LEFT JOIN services on the
      // (tenant_id, svc_id) PK to resolve name/emoji/price. Both join sides are
      // tenant-pinned so another salon's service can't bleed in.
      const rows = await ctx.db
        .select({
          svcId: appointments.svcId,
          names: services.names,
          emoji: services.emoji,
          bookings: sql<number>`count(*)`,
          revenue: sql<number>`coalesce(sum(${services.price}), 0)`,
        })
        .from(appointments)
        .leftJoin(
          services,
          and(eq(services.tenantId, appointments.tenantId), eq(services.svcId, appointments.svcId)),
        )
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.cancelled, 0),
          eq(appointments.noShow, 0),
          gte(appointments.ts, range.fromMs),
        ))
        .groupBy(appointments.svcId)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      return rows.map((r) => ({
        svcId: r.svcId,
        name: parseServiceName(r.names, r.svcId),
        emoji: r.emoji ?? "",
        bookings: Number(r.bookings),
        revenue: Number(r.revenue),
      }));
    }),

  getTopMasters: tenantOwnerProcedure
    .input(
      z.object({
        tenantId: tenantIdSchema,
        period: periodSchema.default("30d"),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<TopMaster[]> => {
      await assertTenantOwner(ctx, input.tenantId);

      const range = periodToRange(input.period, Date.now());
      const limit = input.limit ?? 5;

      // appointments.masterId (int, nullable) joins masters.chatId (int).
      // masters has no text id — identity is chatId; map it to a string for the
      // contract. Drop appointments with no master (master_id IS NOT NULL).
      const rows = await ctx.db
        .select({
          masterId: appointments.masterId,
          name: masters.name,
          bookings: sql<number>`count(*)`,
          revenue: sql<number>`coalesce(sum(${services.price}), 0)`,
        })
        .from(appointments)
        .leftJoin(
          masters,
          and(eq(masters.tenantId, appointments.tenantId), eq(masters.chatId, appointments.masterId)),
        )
        .leftJoin(
          services,
          and(eq(services.tenantId, appointments.tenantId), eq(services.svcId, appointments.svcId)),
        )
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.cancelled, 0),
          eq(appointments.noShow, 0),
          sql`${appointments.masterId} is not null`,
          gte(appointments.ts, range.fromMs),
        ))
        .groupBy(appointments.masterId)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      return rows.map((r) => ({
        masterId: String(r.masterId),
        name: r.name ?? String(r.masterId),
        bookings: Number(r.bookings),
        revenue: Number(r.revenue),
      }));
    }),

  getRecentActivity: tenantOwnerProcedure
    .input(z.object({ tenantId: tenantIdSchema, limit: z.number().int().min(1).max(50).optional() }))
    .query(async ({ ctx, input }): Promise<ActivityItem[]> => {
      await assertTenantOwner(ctx, input.tenantId);

      const limit = input.limit ?? 10;

      // Tenant-scoped mirror of the god-mode `recentActivity` booking entries
      // (metrics.ts): newest by createdAt, client name resolved at read time.
      // Activity is bookings only here; `kind` reuses the god-mode "booking"
      // vocabulary. ts mirrors createdAt (SECONDS), matching the source row.
      const rows = await ctx.db
        .select({ ...getTableColumns(appointments), ...appointmentNameColumns })
        .from(appointments)
        .where(eq(appointments.tenantId, input.tenantId))
        .orderBy(desc(appointments.createdAt))
        .limit(limit);

      return rows.map(foldAppointmentNames).map((a) => ({
        id: a.id,
        name: a.userName ?? a.userTg ?? "—",
        kind: "booking",
        status: a.status,
        ts: a.createdAt,
      }));
    }),
});
