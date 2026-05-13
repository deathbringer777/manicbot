import { z } from "zod";
import { and, desc, eq, gte, isNull, lte, like, or, sql, lt } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { errorEvents } from "~/server/db/schema";

/**
 * Custom error monitoring — God Mode only.
 *
 * The companion Worker side is responsible for ingesting errors (writing rows
 * to `error_events` with deduplication by `fingerprint`). This router only
 * READS / RESOLVES / CLEARS the data for the God Mode UI.
 */

const SEVERITY = z.enum(["fatal", "error", "warning"]);
const SOURCE = z.enum(["worker", "admin-app", "cron", "edge", "unknown"]);

export const errorEventsRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z
        .object({
          severity: SEVERITY.optional(),
          source: SOURCE.optional(),
          tenantId: z.string().max(64).optional(),
          search: z.string().max(200).optional(),
          dateFrom: z.number().int().nonnegative().optional(),
          dateTo: z.number().int().nonnegative().optional(),
          resolved: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().nonnegative().default(0),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.severity) conditions.push(eq(errorEvents.severity, input.severity));
      if (input.source) conditions.push(eq(errorEvents.source, input.source));
      if (input.tenantId) conditions.push(eq(errorEvents.tenantId, input.tenantId));
      if (input.dateFrom !== undefined)
        conditions.push(gte(errorEvents.lastSeen, input.dateFrom));
      if (input.dateTo !== undefined)
        conditions.push(lte(errorEvents.lastSeen, input.dateTo));
      if (input.resolved === true) {
        conditions.push(sql`${errorEvents.resolvedAt} IS NOT NULL`);
      } else if (input.resolved === false) {
        conditions.push(isNull(errorEvents.resolvedAt));
      }
      if (input.search && input.search.trim()) {
        const q = `%${input.search.trim()}%`;
        conditions.push(
          or(like(errorEvents.message, q), like(errorEvents.path, q))!,
        );
      }
      const whereExpr = conditions.length ? and(...conditions) : undefined;

      const rows = await ctx.db
        .select()
        .from(errorEvents)
        .where(whereExpr)
        .orderBy(desc(errorEvents.lastSeen))
        .limit(input.limit)
        .offset(input.offset);

      const totalRows = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(errorEvents)
        .where(whereExpr);

      return {
        rows,
        total: totalRows[0]?.count ?? 0,
      };
    }),

  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(errorEvents)
        .where(eq(errorEvents.id, input.id))
        .limit(1);
      return rows[0] ?? null;
    }),

  stats: adminProcedure.query(async ({ ctx }) => {
    const now = Math.floor(Date.now() / 1000);
    const since24h = now - 24 * 3600;
    const since7d = now - 7 * 86400;

    const [by24h, total24h, by7d, total7d] = await Promise.all([
      ctx.db
        .select({
          severity: errorEvents.severity,
          count: sql<number>`count(*)`,
        })
        .from(errorEvents)
        .where(gte(errorEvents.lastSeen, since24h))
        .groupBy(errorEvents.severity),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(errorEvents)
        .where(gte(errorEvents.lastSeen, since24h)),
      ctx.db
        .select({
          severity: errorEvents.severity,
          count: sql<number>`count(*)`,
        })
        .from(errorEvents)
        .where(gte(errorEvents.lastSeen, since7d))
        .groupBy(errorEvents.severity),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(errorEvents)
        .where(gte(errorEvents.lastSeen, since7d)),
    ]);

    function bucketize(
      rows: Array<{ severity: string; count: number }>,
      total: number,
    ): { fatal: number; error: number; warning: number; total: number } {
      const out = { fatal: 0, error: 0, warning: 0, total };
      for (const r of rows) {
        if (r.severity === "fatal") out.fatal = r.count;
        else if (r.severity === "error") out.error = r.count;
        else if (r.severity === "warning") out.warning = r.count;
      }
      return out;
    }

    return {
      last24h: bucketize(by24h, total24h[0]?.count ?? 0),
      last7d: bucketize(by7d, total7d[0]?.count ?? 0),
    };
  }),

  resolve: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .update(errorEvents)
        .set({ resolvedAt: now })
        .where(eq(errorEvents.id, input.id));
      return { ok: true, resolvedAt: now };
    }),

  /**
   * Maintenance: delete resolved errors older than `olderThanDays` days.
   * Default 30 days. Unresolved errors are never deleted via this path.
   */
  clear: adminProcedure
    .input(
      z
        .object({
          olderThanDays: z.number().int().min(1).max(365).default(30),
        })
        .default({}),
    )
    .mutation(async ({ ctx, input }) => {
      const cutoff =
        Math.floor(Date.now() / 1000) - input.olderThanDays * 86400;
      await ctx.db
        .delete(errorEvents)
        .where(
          and(
            sql`${errorEvents.resolvedAt} IS NOT NULL`,
            lt(errorEvents.resolvedAt, cutoff),
          ),
        );
      return { ok: true, cutoff };
    }),
});
