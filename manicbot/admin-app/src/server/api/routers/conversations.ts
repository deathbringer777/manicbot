/**
 * tRPC router for unified conversations (cross-channel inbox view).
 * Allows the admin-app to list and search conversations across Telegram, WhatsApp, Instagram.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { conversations, tenants, users } from "~/server/db/schema";
import { eq, and, desc, lt, like, sql } from "drizzle-orm";

export const conversationsRouter = createTRPCRouter({
  /**
   * God Mode: all tenants' omnichannel rows (optional tenant + search on channel_user_id).
   */
  listAdmin: adminProcedure
    .input(
      z.object({
        tenantId: z.string().optional(),
        channelType: z.enum(["telegram", "whatsapp", "instagram", "all"]).default("all"),
        status: z.enum(["open", "closed", "all"]).default("open"),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(40),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input.tenantId) conditions.push(eq(conversations.tenantId, input.tenantId));
      if (input.channelType !== "all") conditions.push(eq(conversations.channelType, input.channelType));
      if (input.status !== "all") conditions.push(eq(conversations.status, input.status));
      if (input.search?.trim()) {
        const pat = `%${input.search.trim().replace(/%/g, "\\%")}%`;
        conditions.push(like(conversations.channelUserId, pat));
      }
      const rows = await ctx.db
        .select({
          id: conversations.id,
          tenantId: conversations.tenantId,
          channelType: conversations.channelType,
          channelUserId: conversations.channelUserId,
          internalUserId: conversations.internalUserId,
          status: conversations.status,
          lastMessageAt: conversations.lastMessageAt,
          createdAt: conversations.createdAt,
          tenantName: tenants.name,
        })
        .from(conversations)
        .leftJoin(tenants, eq(conversations.tenantId, tenants.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(conversations.lastMessageAt))
        .limit(input.limit);

      // Resolve user names for conversations that have internalUserId
      const userIds = rows
        .filter((r) => r.internalUserId)
        .map((r) => ({ tenantId: r.tenantId, chatId: r.internalUserId! }));
      const userMap = new Map<string, string>();
      if (userIds.length) {
        const uniqueKeys = [...new Set(userIds.map((u) => `${u.tenantId}:${u.chatId}`))];
        for (const key of uniqueKeys) {
          const [tid, cid] = key.split(":");
          const u = await ctx.db
            .select({ name: users.name, tgUsername: users.tgUsername })
            .from(users)
            .where(and(eq(users.tenantId, tid!), eq(users.chatId, Number(cid))))
            .limit(1);
          if (u[0]) userMap.set(key, u[0].name || (u[0].tgUsername ? `@${u[0].tgUsername}` : ""));
        }
      }

      const items = rows.map((r) => ({
        ...r,
        displayName: userMap.get(`${r.tenantId}:${r.internalUserId}`) || null,
      }));

      return { items };
    }),

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

      // Resolve user names
      const userIds = rows
        .filter((r) => r.internalUserId)
        .map((r) => ({ tenantId: r.tenantId, chatId: r.internalUserId! }));
      const userMap = new Map<string, string>();
      if (userIds.length) {
        const uniqueKeys = [...new Set(userIds.map((u) => `${u.tenantId}:${u.chatId}`))];
        for (const key of uniqueKeys) {
          const [tid, cid] = key.split(":");
          const u = await ctx.db
            .select({ name: users.name, tgUsername: users.tgUsername })
            .from(users)
            .where(and(eq(users.tenantId, tid!), eq(users.chatId, Number(cid))))
            .limit(1);
          if (u[0]) userMap.set(key, u[0].name || (u[0].tgUsername ? `@${u[0].tgUsername}` : ""));
        }
      }

      const items = rows.map((r) => ({
        ...r,
        displayName: userMap.get(`${r.tenantId}:${r.internalUserId}`) || null,
        tenantName: null as string | null,
      }));

      return {
        items,
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
