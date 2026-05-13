import { z } from "zod";
import { and, desc, eq, gte, isNull, lte, like, or, sql, lt } from "drizzle-orm";
import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { errorEvents } from "~/server/db/schema";

/**
 * Custom error monitoring — God Mode only.
 *
 * Worker `captureError()` writes rows here. This router only READS the
 * data and manages issue state: resolve / ignore / snooze / assign /
 * tag / clear. Status lifecycle (migration 0057):
 *   open → resolved (operator-marked)
 *        → ignored  (mute forever)
 *        → snoozed  (mute until snooze_until)
 * A new fire on `resolved` flips it back to `open` automatically — see
 * `manicbot/src/utils/errorCapture.js` for the write-path implementation.
 */

const SEVERITY = z.enum(["fatal", "error", "warning"]);
const SOURCE = z.enum(["worker", "admin-app", "cron", "edge", "unknown"]);
const STATUS = z.enum(["open", "resolved", "ignored", "snoozed"]);

export const errorEventsRouter = createTRPCRouter({
  list: adminProcedure
    .input(
      z
        .object({
          severity: SEVERITY.optional(),
          source: SOURCE.optional(),
          status: STATUS.optional(),
          tenantId: z.string().max(64).optional(),
          assigneeId: z.string().max(64).optional(),
          search: z.string().max(200).optional(),
          dateFrom: z.number().int().nonnegative().optional(),
          dateTo: z.number().int().nonnegative().optional(),
          // Back-compat: `resolved` is the legacy flag from 0056. If
          // `status` is also supplied, `status` wins.
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
      if (input.assigneeId) conditions.push(eq(errorEvents.assigneeId, input.assigneeId));
      if (input.dateFrom !== undefined)
        conditions.push(gte(errorEvents.lastSeen, input.dateFrom));
      if (input.dateTo !== undefined)
        conditions.push(lte(errorEvents.lastSeen, input.dateTo));

      if (input.status) {
        conditions.push(eq(errorEvents.status, input.status));
      } else if (input.resolved === true) {
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

      // Compute `regressed` — issue is currently open but has a non-null
      // resolved_at (meaning the write path flipped it back from resolved
      // due to a new fire). The UI uses this to flag regressions visually.
      const enriched = rows.map((r: typeof rows[number]) => ({
        ...r,
        regressed: r.status === "open" && r.resolvedAt !== null,
      }));

      return {
        rows: enriched,
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
      const r = rows[0];
      if (!r) return null;
      return { ...r, regressed: r.status === "open" && r.resolvedAt !== null };
    }),

  stats: adminProcedure.query(async ({ ctx }) => {
    const now = Math.floor(Date.now() / 1000);
    const since24h = now - 24 * 3600;
    const since7d = now - 7 * 86400;

    const [by24h, total24h, by7d, total7d, byStatus, regressions24h] = await Promise.all([
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
      ctx.db
        .select({
          status: errorEvents.status,
          count: sql<number>`count(*)`,
        })
        .from(errorEvents)
        .groupBy(errorEvents.status),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(errorEvents)
        .where(
          and(
            eq(errorEvents.status, "open"),
            sql`${errorEvents.resolvedAt} IS NOT NULL`,
            gte(errorEvents.lastSeen, since24h),
          ),
        ),
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

    const statusBuckets = { open: 0, resolved: 0, ignored: 0, snoozed: 0 };
    for (const r of byStatus) {
      if (r.status === "open") statusBuckets.open = r.count;
      else if (r.status === "resolved") statusBuckets.resolved = r.count;
      else if (r.status === "ignored") statusBuckets.ignored = r.count;
      else if (r.status === "snoozed") statusBuckets.snoozed = r.count;
    }

    return {
      last24h: bucketize(by24h, total24h[0]?.count ?? 0),
      last7d: bucketize(by7d, total7d[0]?.count ?? 0),
      byStatus: statusBuckets,
      regressions24h: regressions24h[0]?.count ?? 0,
    };
  }),

  resolve: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const actor = ctx.webUser?.id ?? null;
      await ctx.db
        .update(errorEvents)
        .set({
          resolvedAt: now,
          resolvedBy: actor,
          status: "resolved",
          snoozeUntil: null,
        })
        .where(eq(errorEvents.id, input.id));
      return { ok: true, resolvedAt: now };
    }),

  setStatus: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: STATUS,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const actor = ctx.webUser?.id ?? null;

      const patch: Record<string, unknown> = { status: input.status };
      if (input.status === "resolved") {
        patch.resolvedAt = now;
        patch.resolvedBy = actor;
        patch.snoozeUntil = null;
      } else if (input.status === "open") {
        patch.resolvedAt = null;
        patch.resolvedBy = null;
        patch.snoozeUntil = null;
      } else if (input.status === "ignored") {
        patch.snoozeUntil = null;
      }
      // 'snoozed' set via dedicated `snooze` mutation; do not allow here
      // without an explicit snooze_until.
      if (input.status === "snoozed") {
        return { ok: false, error: "use_snooze_mutation" as const };
      }

      await ctx.db.update(errorEvents).set(patch).where(eq(errorEvents.id, input.id));
      return { ok: true as const };
    }),

  snooze: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        hours: z.number().int().min(1).max(720),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const until = Math.floor(Date.now() / 1000) + input.hours * 3600;
      await ctx.db
        .update(errorEvents)
        .set({ status: "snoozed", snoozeUntil: until, resolvedAt: null, resolvedBy: null })
        .where(eq(errorEvents.id, input.id));
      return { ok: true, snoozeUntil: until };
    }),

  assign: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        assigneeId: z.string().max(64).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(errorEvents)
        .set({ assigneeId: input.assigneeId })
        .where(eq(errorEvents.id, input.id));
      return { ok: true };
    }),

  setTags: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        tags: z.array(z.string().max(32)).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tagsJson = JSON.stringify(input.tags);
      await ctx.db
        .update(errorEvents)
        .set({ tagsJson })
        .where(eq(errorEvents.id, input.id));
      return { ok: true };
    }),

  /**
   * Maintenance: delete resolved/ignored errors older than `olderThanDays`.
   * Default 30 days. Open and snoozed errors are never deleted via this path.
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
            or(
              eq(errorEvents.status, "resolved"),
              eq(errorEvents.status, "ignored"),
            )!,
            lt(errorEvents.lastSeen, cutoff),
          ),
        );
      return { ok: true, cutoff };
    }),
});
