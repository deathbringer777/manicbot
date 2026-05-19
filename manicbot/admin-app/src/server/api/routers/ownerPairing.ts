/**
 * Owner Telegram pairing — tRPC surface for migration 0082.
 *
 * Symmetric to `master.requestPairingCode` / `master.getMyPairingState`
 * / `master.unpairTelegram` (see `masterRouter.ts`) but keyed on the
 * tenant_owner's `web_users.id` instead of a `masters.chat_id`.
 *
 * Authorization model:
 *   - Every procedure is `tenantOwnerProcedure` + an explicit check that
 *     `ctx.webUser.tenantId === input.tenantId` so a system_admin
 *     previewing a tenant can NOT silently pair their own Telegram to
 *     the customer's salon.
 *   - The web_user_id used is ALWAYS `ctx.webUser.id` — never taken from
 *     input — so IDOR across web accounts is impossible.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { tenantOwnerProcedure, createTRPCRouter } from "~/server/api/trpc";
import { webUsers, ownerPairingCodes, bots, tenantRoles } from "~/server/db/schema";
import {
  generatePairingToken,
  buildDeepLink,
  PAIRING_TOKEN_TTL_SEC,
} from "~/server/api/ownerPairing/tokenLogic";

function assertCallerOwnsTenant(
  ctx: { webUser: { id: string; tenantId: string | null; webRole: string } | null },
  tenantId: string,
) {
  if (!ctx.webUser) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  // system_admin previewing a tenant: deny — there is no legitimate path
  // for a sysadmin to pair their personal Telegram into a customer's
  // salon. They can use their own bot / tenant if they need to test.
  if (ctx.webUser.webRole !== "tenant_owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the salon owner can manage owner-pairing",
    });
  }
  if (ctx.webUser.tenantId !== tenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "tenant_id mismatch",
    });
  }
}

export const ownerPairingRouter = createTRPCRouter({
  /**
   * Returns the caller's current owner-pairing state for the named
   * tenant. Includes:
   *   • `telegramChatId` — the real TG chat_id if already paired
   *   • `hasActiveCode` + `activeCodeExpiresAt` for a pending code
   *   • `botUsername` so the UI can build the deep-link preview
   */
  getMyPairingState: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertCallerOwnsTenant(ctx, input.tenantId);
      const [me] = await ctx.db
        .select({ telegramChatId: webUsers.telegramChatId, name: webUsers.name })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser!.id))
        .limit(1);
      if (!me) throw new TRPCError({ code: "NOT_FOUND" });

      const now = Math.floor(Date.now() / 1000);
      const [active] = await ctx.db
        .select({ expiresAt: ownerPairingCodes.expiresAt })
        .from(ownerPairingCodes)
        .where(and(
          eq(ownerPairingCodes.tenantId, input.tenantId),
          eq(ownerPairingCodes.webUserId, ctx.webUser!.id),
          isNull(ownerPairingCodes.consumedAt),
          gt(ownerPairingCodes.expiresAt, now),
        ))
        .orderBy(desc(ownerPairingCodes.createdAt))
        .limit(1);

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);

      return {
        telegramChatId: me.telegramChatId ?? null,
        ownerName: me.name ?? null,
        hasActiveCode: !!active,
        activeCodeExpiresAt: active?.expiresAt ?? null,
        botUsername: bot?.botUsername ?? null,
      };
    }),

  /**
   * Mint a fresh pairing token, persist its SHA-256 hash + 7-day TTL,
   * and return the raw token + deep-link URL.
   *
   * The raw token leaves the server exactly once in this response and
   * is then irrecoverable — only `SHA-256(raw)` is stored. The
   * Worker's `/start own_<raw>` consumer recomputes the hash, looks
   * up the row, sets `web_users.telegram_chat_id`, inserts a
   * `tenant_roles` row, and marks the code consumed.
   */
  requestPairingCode: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertCallerOwnsTenant(ctx, input.tenantId);

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);
      if (!bot?.botUsername) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Salon has no active Telegram bot — connect one in Channels first",
        });
      }

      const { raw, hash } = await generatePairingToken();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + PAIRING_TOKEN_TTL_SEC;

      await ctx.db.insert(ownerPairingCodes).values({
        tokenHash: hash,
        tenantId: input.tenantId,
        webUserId: ctx.webUser!.id,
        createdAt: now,
        expiresAt,
      });

      return {
        deepLink: buildDeepLink(bot.botUsername, raw),
        expiresAt,
      };
    }),

  /**
   * Unbind the previously-paired Telegram account. Clears
   * `web_users.telegram_chat_id` AND removes the `tenant_roles` row
   * scoped to the caller's chat_id so `resolveRole` stops returning
   * `tenant_owner` for that Telegram identity.
   *
   * Does NOT delete past pairing-code rows (audit trail) and does NOT
   * cancel pending unconsumed codes — the owner is free to re-mint
   * and re-pair (possibly to a different Telegram account).
   */
  unpair: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertCallerOwnsTenant(ctx, input.tenantId);

      const [me] = await ctx.db
        .select({ telegramChatId: webUsers.telegramChatId })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser!.id))
        .limit(1);
      if (!me) throw new TRPCError({ code: "NOT_FOUND" });

      const previousChatId = me.telegramChatId;

      await ctx.db
        .update(webUsers)
        .set({ telegramChatId: null, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(webUsers.id, ctx.webUser!.id));

      // Remove the tenant_roles row that the pairing flow inserted.
      // If the row was created by a different code path (manual
      // provisioning, support escalation) we still want to remove it —
      // an unpair gesture should de-elevate the Telegram identity from
      // tenant_owner status. Anything more nuanced would surprise the
      // user.
      if (previousChatId !== null && previousChatId !== undefined) {
        await ctx.db
          .delete(tenantRoles)
          .where(and(
            eq(tenantRoles.tenantId, input.tenantId),
            eq(tenantRoles.chatId, previousChatId),
            eq(tenantRoles.role, "tenant_owner"),
          ));
      }

      return { ok: true };
    }),
});
