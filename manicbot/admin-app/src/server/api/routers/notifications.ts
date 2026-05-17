/**
 * notifications router — bell-icon feed.
 *
 * Generic notification surface. The reminders plugin's cron writes here
 * via the worker `notifyWebUser` helper; future features (checklists,
 * marketing automations, billing alerts) use the same kind/source_slug
 * shape — no router changes needed.
 *
 * All ops are scoped by `ctx.webUser.id`. A signed-in user can ONLY read
 * + mark-read their own rows. No cross-user listing.
 */

import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { userNotifications } from "~/server/db/schema";

const ID_LIST = z.array(z.string().min(1)).min(1).max(100);

export const notificationsRouter = createTRPCRouter({
  // ------------------------------------------------------------------
  // list — recent notifications for the current user.
  // ------------------------------------------------------------------
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          unreadOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const uid = ctx.webUser!.id;
      const conds: ReturnType<typeof eq>[] = [eq(userNotifications.webUserId, uid)];
      if (input?.unreadOnly) {
        conds.push(isNull(userNotifications.readAt) as ReturnType<typeof eq>);
      }
      const rows = await ctx.db
        .select()
        .from(userNotifications)
        .where(and(...conds))
        .orderBy(desc(userNotifications.createdAt))
        .limit(limit);
      return rows;
    }),

  // ------------------------------------------------------------------
  // unreadCount — badge number for the header bell.
  // ------------------------------------------------------------------
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.webUser!.id;
    const rows = await ctx.db
      .select({ c: sql<number>`count(*)` })
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.webUserId, uid),
          isNull(userNotifications.readAt),
        ),
      );
    return { count: Number(rows[0]?.c ?? 0) };
  }),

  // ------------------------------------------------------------------
  // markRead — flip a specific set of rows to read.
  // ------------------------------------------------------------------
  markRead: protectedProcedure
    .input(z.object({ ids: ID_LIST }))
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.webUser!.id;
      const now = Math.floor(Date.now() / 1000);
      const res = await ctx.db
        .update(userNotifications)
        .set({ readAt: now })
        .where(
          and(
            eq(userNotifications.webUserId, uid),
            inArray(userNotifications.id, input.ids),
          ),
        );
      // Drizzle's D1 driver does not standardise the changes count on UPDATE;
      // we return { ok: true } and let the client invalidate its query.
      return { ok: true, changes: (res as { meta?: { changes?: number } })?.meta?.changes ?? null };
    }),

  // ------------------------------------------------------------------
  // markAllRead — bulk mark-read for the current user.
  // ------------------------------------------------------------------
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const uid = ctx.webUser!.id;
    const now = Math.floor(Date.now() / 1000);
    await ctx.db
      .update(userNotifications)
      .set({ readAt: now })
      .where(
        and(
          eq(userNotifications.webUserId, uid),
          isNull(userNotifications.readAt),
        ),
      );
    return { ok: true };
  }),

  // ------------------------------------------------------------------
  // dismiss — hard-delete a specific notification (e.g. when user clicks
  // "Dismiss" from the bell dropdown). Cannot delete other users' rows.
  // ------------------------------------------------------------------
  dismiss: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.webUser!.id;
      const existing = await ctx.db
        .select({ id: userNotifications.id })
        .from(userNotifications)
        .where(
          and(
            eq(userNotifications.id, input.id),
            eq(userNotifications.webUserId, uid),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .delete(userNotifications)
        .where(eq(userNotifications.id, input.id));
      return { ok: true };
    }),
});
