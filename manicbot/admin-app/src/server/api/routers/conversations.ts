/**
 * tRPC router for unified conversations (cross-channel inbox view).
 * Allows the admin-app to list and search conversations across Telegram, WhatsApp, Instagram.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { conversations } from "~/server/db/schema";
import { eq, and, desc, lt } from "drizzle-orm";

export const conversationsRouter = createTRPCRouter({
  /**
   * List recent conversations for a tenant (paginated, newest first).
   */
  list: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        channelType: z.enum(["telegram", "whatsapp", "instagram", "all"]).default("all"),
        status: z.enum(["open", "closed", "all"]).default("open"),
        cursor: z.number().optional(), // last_message_at cursor for pagination
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const conditions = [eq(conversations.tenantId, input.tenantId)];
      if (input.channelType !== "all") conditions.push(eq(conversations.channelType, input.channelType));
      if (input.status !== "all") conditions.push(eq(conversations.status, input.status));
      if (input.cursor) conditions.push(lt(conversations.lastMessageAt, input.cursor));

      const rows = await ctx.db
        .select()
        .from(conversations)
        .where(and(...conditions))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(input.limit);

      return {
        items: rows,
        nextCursor: rows.length === input.limit ? rows[rows.length - 1]?.lastMessageAt : undefined,
      };
    }),

  /**
   * Get a single conversation by ID.
   */
  get: protectedProcedure
    .input(z.object({ tenantId: z.string(), id: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const row = await ctx.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, input.id), eq(conversations.tenantId, input.tenantId)))
        .limit(1);
      return row[0] ?? null;
    }),

  /**
   * Update status of a conversation (open/closed).
   */
  setStatus: protectedProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      status: z.enum(["open", "closed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .update(conversations)
        .set({ status: input.status })
        .where(and(eq(conversations.id, input.id), eq(conversations.tenantId, input.tenantId)));
      return { ok: true };
    }),
});
