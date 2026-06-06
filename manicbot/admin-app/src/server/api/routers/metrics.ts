import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { tenants, appointments, webUsers } from "~/server/db/schema";
import { sql, desc, and, eq, gte, asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { getPlatformMetrics } from "~/server/metrics/platform";

/**
 * Activity-feed entry kinds. The client renders gender-neutral labels via
 * i18n (see `activity.tenantCreated` / `activity.booking*` keys + the
 * `formatRelativeTime` helper).
 */
export type ActivityKind = "tenant_created" | "booking";
export type BookingStatus = "confirmed" | "pending" | "cancelled" | "rejected" | "no_show" | "done";

const REFERRAL_STACK_KEYS = ["google", "instagram", "telegram", "friends", "other", "unspecified"] as const;
export type ReferralStackKey = (typeof REFERRAL_STACK_KEYS)[number];

function normalizeReferralSource(raw: string): ReferralStackKey {
  if (
    raw === "google" ||
    raw === "instagram" ||
    raw === "telegram" ||
    raw === "friends" ||
    raw === "other" ||
    raw === "unspecified"
  ) {
    return raw;
  }
  return "other";
}

export const metricsRouter = createTRPCRouter({
  getDashboardStats: adminProcedure.query(async ({ ctx }) => {
    const today = new Date().toISOString().split("T")[0]!;
    const now = Math.floor(Date.now() / 1000);

    // Platform KPIs (paying / comped / trials / MRR) come from the shared
    // metrics module — test tenants, expired trials, grant/promo "active"
    // tenants AND secondary salons (parent_tenant_id, via classifyTenant) are
    // already excluded there. Operational counts below are scoped to non-test
    // tenants; the tenant count also drops secondaries so an owner counts once.
    const [platform, tenantsCount, totalApts, todayApts] = await Promise.all([
      getPlatformMetrics(ctx.db, now),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(tenants)
        .where(and(eq(tenants.isTest, 0), isNull(tenants.parentTenantId))),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
        .where(and(eq(tenants.isTest, 0), eq(appointments.cancelled, 0))),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
        .where(and(eq(tenants.isTest, 0), eq(appointments.date, today), eq(appointments.cancelled, 0))),
    ]);

    const [recentTenants, recentApts] = await Promise.all([
      ctx.db
        .select({ id: tenants.id, name: tenants.name, createdAt: tenants.createdAt })
        .from(tenants)
        .where(eq(tenants.isTest, 0))
        .orderBy(desc(tenants.createdAt))
        .limit(5),
      ctx.db
        .select({
          id: appointments.id,
          userName: appointments.userName,
          userTg: appointments.userTg,
          status: appointments.status,
          createdAt: appointments.createdAt,
        })
        .from(appointments)
        .innerJoin(tenants, eq(appointments.tenantId, tenants.id))
        .where(eq(tenants.isTest, 0))
        .orderBy(desc(appointments.createdAt))
        .limit(5),
    ]);

    // Structured activity entries — client formats text via i18n so we don't
    // ship hardcoded ru/en strings from the server (and avoid gender-bound
    // verbs like "записался" that read wrong for feminine subjects).
    const activity = [
      ...recentTenants.map((t) => ({
        id: t.id,
        name: t.name,
        kind: "tenant_created" as ActivityKind,
        status: null as BookingStatus | null,
        icon: "salon" as const,
        ts: t.createdAt,
      })),
      ...recentApts.map((a) => ({
        id: a.id,
        name: a.userName ?? a.userTg ?? "—",
        kind: "booking" as ActivityKind,
        status: (a.status as BookingStatus) ?? "pending",
        icon: "appointment" as const,
        ts: a.createdAt,
      })),
    ]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8);

    return {
      // ── Platform KPIs (test/expired/comped excluded) ──
      ourCustomers: platform.ourCustomers,
      paying: platform.paying,
      comped: platform.comped,
      activeTrials: platform.activeTrials,
      churned: platform.churned,
      mrr: platform.mrrPln,
      arr: platform.arrPln,
      // ── Operational (non-test tenants only) ──
      totalTenants: tenantsCount[0]?.count ?? 0,
      totalAppointments: totalApts[0]?.count ?? 0,
      todayAppointments: todayApts[0]?.count ?? 0,
      recentActivity: activity,
      // ── Legacy aliases — kept until every consumer migrates to the
      //    explicit fields above. totalUsers used to count ALL telegram
      //    end-customers (incl. test tenants); it now means "our real
      //    salon accounts". ──
      totalUsers: platform.ourCustomers,
      activeSubscriptions: platform.paying,
      trialingCount: platform.activeTrials,
    };
  }),

  getChartData: adminProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - input.days * 86400;
      const result = await ctx.db
        .select({ date: appointments.date, count: sql<number>`count(*)` })
        .from(appointments)
        .where(and(gte(appointments.ts, since), eq(appointments.cancelled, 0)))
        .groupBy(appointments.date)
        .orderBy(appointments.date);

      // Fill gaps with 0
      const map = Object.fromEntries(result.map((r) => [r.date, r.count]));
      const data: { date: string; appointments: number }[] = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0]!;
        data.push({ date: key, appointments: map[key] ?? 0 });
      }
      return data;
    }),

  /** Web self-signups: referral_source breakdown + daily stacked counts (God Mode). */
  getWebSignupReferralStats: adminProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const since = Math.floor(Date.now() / 1000) - input.days * 86400;

      const [totalsInPeriod, dailyRaw] = await Promise.all([
        ctx.db
          .select({
            source: sql<string>`coalesce(${webUsers.referralSource}, 'unspecified')`,
            count: sql<number>`count(*)`,
          })
          .from(webUsers)
          .where(gte(webUsers.createdAt, since))
          .groupBy(sql`coalesce(${webUsers.referralSource}, 'unspecified')`),
        ctx.db
          .select({
            day: sql<string>`strftime('%Y-%m-%d', ${webUsers.createdAt}, 'unixepoch')`,
            source: sql<string>`coalesce(${webUsers.referralSource}, 'unspecified')`,
            count: sql<number>`count(*)`,
          })
          .from(webUsers)
          .where(gte(webUsers.createdAt, since))
          .groupBy(
            sql`strftime('%Y-%m-%d', ${webUsers.createdAt}, 'unixepoch')`,
            sql`coalesce(${webUsers.referralSource}, 'unspecified')`,
          )
          .orderBy(asc(sql`strftime('%Y-%m-%d', ${webUsers.createdAt}, 'unixepoch')`)),
      ]);

      type StackRow = {
        date: string;
        google: number;
        instagram: number;
        telegram: number;
        friends: number;
        other: number;
        unspecified: number;
      };

      const dayMap = new Map<string, StackRow>();
      for (let i = input.days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split("T")[0]!;
        dayMap.set(key, {
          date: key,
          google: 0,
          instagram: 0,
          telegram: 0,
          friends: 0,
          other: 0,
          unspecified: 0,
        });
      }

      for (const row of dailyRaw) {
        const day = row.day;
        const bucket = normalizeReferralSource(row.source);
        const rec = dayMap.get(day);
        if (!rec) continue;
        rec[bucket] += row.count;
      }

      const bySourceInPeriod = totalsInPeriod.map((r) => ({
        source: normalizeReferralSource(r.source),
        count: r.count,
      }));

      const mergedMap = new Map<ReferralStackKey, number>();
      for (const k of REFERRAL_STACK_KEYS) mergedMap.set(k, 0);
      for (const r of bySourceInPeriod) {
        mergedMap.set(r.source, (mergedMap.get(r.source) ?? 0) + r.count);
      }

      const bySourceMerged = REFERRAL_STACK_KEYS.map((source) => ({
        source,
        count: mergedMap.get(source) ?? 0,
      })).filter((r) => r.count > 0);

      const totalSignupsInPeriod = bySourceInPeriod.reduce((s, r) => s + r.count, 0);

      return {
        bySourceInPeriod: bySourceMerged,
        dailySignupBySource: [...dayMap.values()],
        totalSignupsInPeriod,
      };
    }),
});
