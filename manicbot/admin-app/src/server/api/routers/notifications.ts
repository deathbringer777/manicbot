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
import { userNotifications, webUsers } from "~/server/db/schema";
import {
  DEFAULT_PREFS,
  NOTIFICATION_CATEGORIES,
  parsePrefs,
  serializePrefs,
  type NotificationCategory,
} from "~/lib/notifications/prefs";
import { notifyWebUser } from "~/server/services/notifyWebUser";

const ID_LIST = z.array(z.string().min(1)).min(1).max(100);

const CATEGORY_ENUM = z.enum(NOTIFICATION_CATEGORIES as unknown as [NotificationCategory, ...NotificationCategory[]]);
const PREF_INPUT = z.object({
  categories: z.record(
    CATEGORY_ENUM,
    z.object({
      inapp: z.boolean(),
      push: z.boolean(),
      // Optional so existing {inapp,push} callers stay valid; the email
      // channel (migration 0100) is merged in when supplied.
      email: z.boolean().optional(),
    }),
  ).optional(),
});

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

  // ------------------------------------------------------------------
  // getMyPrefs — return the user's saved notification_prefs JSON, parsed
  // into a complete shape (missing categories filled from DEFAULT_PREFS).
  // Returning a full shape means the settings UI doesn't have to know
  // about defaults.
  // ------------------------------------------------------------------
  getMyPrefs: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.webUser!.id;
    const rows = await ctx.db
      .select({ raw: webUsers.notificationPrefs })
      .from(webUsers)
      .where(eq(webUsers.id, uid))
      .limit(1);
    return parsePrefs(rows[0]?.raw ?? null);
  }),

  // ------------------------------------------------------------------
  // setMyPrefs — merge supplied categories into the user's saved prefs.
  // Partial updates supported: omit a category and its current setting
  // survives. The serialized blob is always canonical (key order matches
  // NOTIFICATION_CATEGORIES) so a round-trip is stable.
  // ------------------------------------------------------------------
  setMyPrefs: protectedProcedure
    .input(PREF_INPUT)
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.webUser!.id;
      const rows = await ctx.db
        .select({ raw: webUsers.notificationPrefs })
        .from(webUsers)
        .where(eq(webUsers.id, uid))
        .limit(1);
      const current = parsePrefs(rows[0]?.raw ?? null);
      const next = {
        categories: { ...current.categories },
      };
      if (input.categories) {
        for (const [cat, value] of Object.entries(input.categories)) {
          if (value) {
            // Merge (not replace) so a partial update — e.g. toggling only
            // `inapp` — preserves the category's other channels (push/email).
            const key = cat as NotificationCategory;
            next.categories[key] = { ...next.categories[key], ...value };
          }
        }
      }
      const serialized = serializePrefs(next);
      await ctx.db
        .update(webUsers)
        .set({ notificationPrefs: serialized, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(webUsers.id, uid));
      return next;
    }),

  // ------------------------------------------------------------------
  // resetMyPrefs — wipe the JSON column. Subsequent loads resolve to
  // DEFAULT_PREFS — same as a brand-new account.
  // ------------------------------------------------------------------
  resetMyPrefs: protectedProcedure.mutation(async ({ ctx }) => {
    const uid = ctx.webUser!.id;
    await ctx.db
      .update(webUsers)
      .set({ notificationPrefs: null, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(webUsers.id, uid));
    return DEFAULT_PREFS;
  }),

  // ------------------------------------------------------------------
  // sendTestNotification — drops a test row into the bell + (optionally)
  // a push. Used by the settings panel to let the user verify the
  // delivery pipeline works for their account.
  //
  // PR-D: optional `category` input lets the settings UI fire a test
  // PER CATEGORY (`<category>.test`) so the user can confirm that
  // toggling, say, the billing category actually gates whether they
  // see a billing row. Without `category` we keep the legacy
  // `support.test` behavior (always delivered, even when support is
  // opted-out — the notifyWebUser helper has a special case for
  // `support.test`).
  //
  // Server-side gate: the partial UNIQUE on
  // (sourceSlug='self_test', sourceId) dedups accidental double-clicks
  // so the row count cannot blow up. SourceId buckets by the minute so
  // a user can still re-trigger after 60s.
  // ------------------------------------------------------------------
  sendTestNotification: protectedProcedure
    .input(
      z
        .object({
          category: CATEGORY_ENUM.optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.webUser!.id;
      const now = Math.floor(Date.now() / 1000);
      const minuteBucket = Math.floor(now / 60);
      const category = input?.category;
      const kind = category ? `${category}.test` : "support.test";
      const titleByCategory: Record<string, string> = {
        appointment: "ManicBot · тест категории «Записи»",
        support: "ManicBot · тест категории «Поддержка»",
        birthday: "ManicBot · тест категории «Дни рождения»",
        platform: "ManicBot · тест категории «Платформа»",
        master: "ManicBot · тест категории «Мастера»",
        reminder: "ManicBot · тест категории «Напоминания»",
        messenger: "ManicBot · тест категории «Сообщения»",
        billing: "ManicBot · тест категории «Биллинг»",
        marketing: "ManicBot · тест категории «Маркетинг»",
        channel: "ManicBot · тест категории «Каналы»",
        client: "ManicBot · тест категории «Клиенты»",
      };
      const title = category
        ? (titleByCategory[category] ?? `ManicBot · тест «${category}»`)
        : "ManicBot · тест уведомлений";
      const r = await notifyWebUser(ctx.db, {
        webUserId: uid,
        kind,
        title,
        body: "Если вы видите это в звонке — пайплайн доставки этой категории работает.",
        link: "/notifications",
        sourceSlug: "self_test",
        sourceId: `t_${uid}_${category ?? "support"}_${minuteBucket}`,
      });
      return {
        ok: r.ok,
        deduped: r.deduped ?? false,
        skippedByPrefs: r.skippedByPrefs ?? false,
        kind,
      };
    }),
});
