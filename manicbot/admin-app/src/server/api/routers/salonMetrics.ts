/**
 * salonMetrics — tenant-scoped aggregate metrics for the configurable "Домой"
 * (overview) widget board (KPI blocks, calendar heatmap, top services/masters,
 * activity feed).
 *
 * ⚠️ PHASE-0 STUB. The procedure SIGNATURES, input schemas, and exported return
 * TYPES below are the FROZEN CONTRACT that the widget board + settings build
 * against in parallel. Agent A (backend) replaces the stub bodies with real
 * Drizzle aggregates via TDD — tests first — WITHOUT changing the signatures or
 * exported types. `root.ts` already registers this router (do not re-wire it).
 *
 * Invariants Agent A MUST preserve:
 *   - Every procedure: `tenantOwnerProcedure` + `await assertTenantOwner(...)`.
 *   - EVERY query WHERE includes `eq(table.tenantId, input.tenantId)` (tenant
 *     isolation; cross-tenant leakage test required per procedure).
 *   - Revenue = SUM(services.price) over appointments with `cancelled = 0 AND
 *     noShow = 0` in the CURRENT MONTH (excludes cancels + no-shows). Pin it
 *     with a test.
 *   - Mirror the `Promise.all` aggregate style of `salon.getOverview`; reuse
 *     `appointmentNameColumns` / `foldAppointmentNames` for activity names.
 *   - `masters` has no text id — its identity is `chatId` (int). Map it to the
 *     contract's string `masterId`. `appointments.masterId` (int) joins
 *     `masters.chatId`. `appointments.ts` is epoch MILLISECONDS.
 */
import { z } from "zod";
import { createTRPCRouter, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";

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

export const salonMetricsRouter = createTRPCRouter({
  getKpiSummary: tenantOwnerProcedure
    .input(z.object({ tenantId: tenantIdSchema, period: periodSchema.default("30d") }))
    .query(async ({ ctx, input }): Promise<KpiSummary> => {
      await assertTenantOwner(ctx, input.tenantId);
      // TODO(Agent A): real aggregates. Stub returns zeros so the board +
      // settings typecheck against the frozen contract during parallel work.
      return {
        totalClients: 0,
        newClients: 0,
        weekAppointments: 0,
        monthRevenue: 0,
        noShowRate: 0,
        doneCount: 0,
        period: input.period,
      };
    }),

  getDailyCounts: tenantOwnerProcedure
    .input(z.object({ tenantId: tenantIdSchema, days: z.number().int().min(1).max(366).default(30) }))
    .query(async ({ ctx, input }): Promise<DailyCount[]> => {
      await assertTenantOwner(ctx, input.tenantId);
      // TODO(Agent A): per-day appointment counts over the last `days`, gaps 0.
      return [];
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
      // TODO(Agent A): top services by bookings + revenue over the period.
      return [];
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
      // TODO(Agent A): top masters by bookings + revenue over the period.
      return [];
    }),

  getRecentActivity: tenantOwnerProcedure
    .input(z.object({ tenantId: tenantIdSchema, limit: z.number().int().min(1).max(50).optional() }))
    .query(async ({ ctx, input }): Promise<ActivityItem[]> => {
      await assertTenantOwner(ctx, input.tenantId);
      // TODO(Agent A): recent tenant activity (bookings/reviews/etc.).
      return [];
    }),
});
