/**
 * pushSubscriptions router — Web Push (browser push notifications) opt-in
 * + revoke + listing.
 *
 * Browsers obtain a PushSubscription via PushManager.subscribe({
 *   userVisibleOnly: true,
 *   applicationServerKey: <VAPID public key>
 * }) and POST the result here. The Worker reads the resulting row when
 * it needs to fan out a notification.
 *
 * Critical invariants:
 *   - Every read + mutation is scoped to ctx.webUser.id (no cross-user
 *     reads of subscriptions).
 *   - subscribe is idempotent on the (web_user_id, endpoint) UNIQUE
 *     constraint — re-subscribing from the same browser overwrites
 *     instead of duplicating.
 *   - getVapidPublicKey is public-ish (still requires a web session, but
 *     no further auth) — the public key is by definition non-secret.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { pushSubscriptions } from "~/server/db/schema";
import { env } from "~/env";

function newSubscriptionId(): string {
  const ts = Date.now().toString(36);
  const rand = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36)).replace(/-/g, "").slice(0, 12);
  return `ps_${ts}_${rand}`;
}

export const pushSubscriptionsRouter = createTRPCRouter({
  /**
   * Returns the VAPID public key for the frontend to call
   * PushManager.subscribe({ applicationServerKey }). Null when the
   * platform hasn't deployed VAPID keys yet — the bell UI then hides
   * the «Включить пуши» button.
   */
  getVapidPublicKey: protectedProcedure.query(() => {
    const key = (env as any).VAPID_PUBLIC_KEY as string | undefined;
    if (!key) return { publicKey: null as string | null, enabled: false };
    return { publicKey: key, enabled: true };
  }),

  /**
   * Upsert a subscription. The browser POSTs the PushSubscription JSON
   * (endpoint + keys.p256dh + keys.auth) plus its user-agent string.
   */
  subscribe: protectedProcedure
    .input(z.object({
      endpoint: z.string().url().max(2000),
      p256dh: z.string().min(1).max(200),
      auth: z.string().min(1).max(80),
      userAgent: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      const now = Math.floor(Date.now() / 1000);

      // Idempotent upsert keyed on (web_user_id, endpoint). Use the
      // partial UNIQUE from migration 0073: any retry from the same
      // browser refreshes the keys and timestamps instead of duplicating.
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          id: newSubscriptionId(),
          webUserId: ctx.webUser.id,
          tenantId: ctx.webUser.tenantId ?? null,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent ?? null,
          createdAt: now,
          lastUsedAt: null,
          failureCount: 0,
        })
        .onConflictDoUpdate({
          target: [pushSubscriptions.webUserId, pushSubscriptions.endpoint],
          set: {
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent ?? null,
            // Don't reset createdAt; do reset failureCount on a fresh subscribe.
            failureCount: 0,
          },
        });

      return { ok: true };
    }),

  /**
   * Remove a subscription by endpoint. Called when the user toggles
   * push off, or when the browser surfaces a PushSubscription change
   * event and we need to clean stale rows.
   */
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().url().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      await ctx.db
        .delete(pushSubscriptions)
        .where(and(
          eq(pushSubscriptions.webUserId, ctx.webUser.id),
          eq(pushSubscriptions.endpoint, input.endpoint),
        ));
      return { ok: true };
    }),

  /**
   * List the current user's subscriptions. UI uses this to render the
   * «N устройств подписано» chip and a per-device revoke button.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
    const rows = await ctx.db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        userAgent: pushSubscriptions.userAgent,
        createdAt: pushSubscriptions.createdAt,
        lastUsedAt: pushSubscriptions.lastUsedAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.webUserId, ctx.webUser.id))
      .limit(50);
    return rows;
  }),
});
