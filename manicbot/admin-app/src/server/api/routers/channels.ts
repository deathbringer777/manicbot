/**
 * tRPC router for channel management (WhatsApp + Instagram configurations).
 * Allows tenants to view, create, update, and delete their channel configs.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { channelConfigs } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";

export const channelRouter = createTRPCRouter({
  /**
   * List all channel configs for the caller's tenantId
   */
  list: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({
          id: channelConfigs.id,
          channelType: channelConfigs.channelType,
          active: channelConfigs.active,
          webhookVerifyToken: channelConfigs.webhookVerifyToken,
          createdAt: channelConfigs.createdAt,
          updatedAt: channelConfigs.updatedAt,
          // config (may contain phone_number_id or page_id)
          config: channelConfigs.config,
          // Do NOT expose token_encrypted
        })
        .from(channelConfigs)
        .where(eq(channelConfigs.tenantId, input.tenantId));
      return rows;
    }),

  /**
   * Get a single channel config (without token)
   */
  get: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const row = await ctx.db
        .select()
        .from(channelConfigs)
        .where(and(eq(channelConfigs.id, input.id), eq(channelConfigs.tenantId, input.tenantId)))
        .limit(1);
      return row[0] ?? null;
    }),

  /**
   * Create or overwrite a channel config.
   * Token is passed in plaintext and will be encrypted server-side.
   * (Actual encryption happens via the worker's token-manager — admin-app only stores metadata.)
   *
   * For MVP: client POSTs to the worker /api/channels endpoint directly;
   * this tRPC route is for reading and toggling active state.
   */
  upsert: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        channelType: z.enum(["whatsapp", "instagram"]),
        config: z.string().optional(),
        webhookVerifyToken: z.string().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = Math.floor(Date.now() / 1000);

      // Check if a row exists
      const existing = await ctx.db
        .select({ id: channelConfigs.id })
        .from(channelConfigs)
        .where(
          and(eq(channelConfigs.tenantId, input.tenantId), eq(channelConfigs.channelType, input.channelType))
        )
        .limit(1);

      if (existing.length) {
        await ctx.db
          .update(channelConfigs)
          .set({
            config: input.config,
            webhookVerifyToken: input.webhookVerifyToken,
            active: input.active !== false ? 1 : 0,
            updatedAt: now,
          })
          .where(eq(channelConfigs.id, existing[0]!.id));
        return { id: existing[0]!.id };
      }

      // Create new
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      await ctx.db.insert(channelConfigs).values({
        id,
        tenantId: input.tenantId,
        channelType: input.channelType,
        config: input.config,
        webhookVerifyToken: input.webhookVerifyToken,
        active: input.active !== false ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });
      return { id };
    }),

  /**
   * Toggle active state of a channel config.
   */
  setActive: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .update(channelConfigs)
        .set({ active: input.active ? 1 : 0, updatedAt: now })
        .where(and(eq(channelConfigs.id, input.id), eq(channelConfigs.tenantId, input.tenantId)));
      return { ok: true };
    }),

  /**
   * Delete a channel config entirely.
   */
  delete: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .delete(channelConfigs)
        .where(and(eq(channelConfigs.id, input.id), eq(channelConfigs.tenantId, input.tenantId)));
      return { ok: true };
    }),
});
