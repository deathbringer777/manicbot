/**
 * /system/events — God Mode page for inspecting recent analytics events.
 *
 * The reader side of the analytics layer (writes happen via
 * `~/server/services/recordEvent.ts`). All procedures are
 * `adminProcedure` — cross-tenant by design, only system_admin /
 * technical_support / support roles can hit this surface.
 */

import { z } from "zod";
import { sql, desc, eq, and, gte, lte, inArray, like } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { analyticsEvents } from "~/server/db/schema";
import { ANALYTICS_EVENTS } from "~/server/services/recordEvent";

const MAX_PAGE_SIZE = 200;

export const analyticsEventsRouter = createTRPCRouter({
  /**
   * Paginated event list with filters. Used by the /system/events table.
   */
  list: adminProcedure
    .input(
      z.object({
        events: z.array(z.string()).optional(),
        tenantId: z.string().optional(),
        userId: z.string().optional(),
        sinceSec: z.number().int().nonnegative().optional(),
        untilSec: z.number().int().nonnegative().optional(),
        searchProperties: z.string().max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conds: ReturnType<typeof eq>[] = [];
      if (input.events && input.events.length > 0) {
        conds.push(inArray(analyticsEvents.event, input.events));
      }
      if (input.tenantId) conds.push(eq(analyticsEvents.tenantId, input.tenantId));
      if (input.userId) conds.push(eq(analyticsEvents.userId, input.userId));
      if (input.sinceSec) conds.push(gte(analyticsEvents.createdAt, input.sinceSec));
      if (input.untilSec) conds.push(lte(analyticsEvents.createdAt, input.untilSec));
      if (input.searchProperties) {
        conds.push(like(analyticsEvents.properties, `%${input.searchProperties}%`));
      }
      const whereExpr = conds.length > 0 ? and(...conds) : undefined;

      const rows = await ctx.db
        .select()
        .from(analyticsEvents)
        .where(whereExpr)
        .orderBy(desc(analyticsEvents.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const totalRow = await ctx.db
        .select({ c: sql<number>`COUNT(*)` })
        .from(analyticsEvents)
        .where(whereExpr);
      const total = Number(totalRow[0]?.c ?? 0);

      return {
        rows: rows.map((r) => ({
          id: r.id,
          event: r.event,
          tenantId: r.tenantId,
          userId: r.userId,
          properties: r.properties,
          createdAt: r.createdAt,
        })),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /**
   * Aggregate stats for the page header — last 24h + last 7d counts per
   * canonical event slug. Heavy-ish but only run when the page mounts.
   */
  stats: adminProcedure.query(async ({ ctx }) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const day = nowSec - 86_400;
    const week = nowSec - 7 * 86_400;
    const slugs = Object.values(ANALYTICS_EVENTS);

    const rows = await ctx.db
      .select({
        event: analyticsEvents.event,
        countDay: sql<number>`SUM(CASE WHEN ${analyticsEvents.createdAt} >= ${day} THEN 1 ELSE 0 END)`,
        countWeek: sql<number>`SUM(CASE WHEN ${analyticsEvents.createdAt} >= ${week} THEN 1 ELSE 0 END)`,
      })
      .from(analyticsEvents)
      .where(and(inArray(analyticsEvents.event, slugs), gte(analyticsEvents.createdAt, week)))
      .groupBy(analyticsEvents.event);

    const map: Record<string, { day: number; week: number }> = {};
    for (const r of rows) {
      map[r.event] = { day: Number(r.countDay ?? 0), week: Number(r.countWeek ?? 0) };
    }
    // Always return one entry per known slug, even if zero, so the UI
    // doesn't need to do null-coalescing per slug.
    return slugs.map((slug) => ({
      event: slug,
      day: map[slug]?.day ?? 0,
      week: map[slug]?.week ?? 0,
    }));
  }),

  /**
   * Distinct event names actually present in the table — populates the
   * filter dropdown so an operator can see all events ever fired even
   * if the canonical slug list grew between deploys.
   */
  distinctEvents: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .selectDistinct({ event: analyticsEvents.event })
      .from(analyticsEvents)
      .orderBy(analyticsEvents.event);
    return rows.map((r) => r.event);
  }),
});
