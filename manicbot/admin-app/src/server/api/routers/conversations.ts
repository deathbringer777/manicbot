/**
 * tRPC router for unified conversations (cross-channel inbox view).
 * Allows the admin-app to list and search conversations across Telegram, WhatsApp, Instagram.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, adminProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { conversations, tenants, users } from "~/server/db/schema";
import { eq, and, desc, lt, like, sql, inArray } from "drizzle-orm";

export const conversationsRouter = createTRPCRouter({
  /**
   * God Mode: all tenants' unified-inbox rows (optional tenant + search on channel_user_id).
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

      // Batch-resolve user names for conversations that have internalUserId.
      // Old: one SELECT per unique (tenantId, chatId) pair — N+1 under load.
      // Fix: collect all chatIds per tenant and issue a single IN-query per tenant
      // (or one cross-tenant IN-query for the admin view which already spans
      // multiple tenants). Since conversations in admin view are already scoped
      // to one tenant via filter or paginated small sets, a single IN-query is safe.
      const userIds = rows
        .filter((r) => r.internalUserId)
        .map((r) => ({ tenantId: r.tenantId, chatId: Number(r.internalUserId!) }));
      const userMap = new Map<string, string>();
      if (userIds.length) {
        // Deduplicate by (tenantId, chatId) key.
        const uniqueMap = new Map<string, { tenantId: string; chatId: number }>();
        for (const u of userIds) {
          uniqueMap.set(`${u.tenantId}:${u.chatId}`, u);
        }
        // Group by tenantId to produce one IN-query per tenant (typically 1).
        const byTenant = new Map<string, number[]>();
        for (const { tenantId: tid, chatId } of uniqueMap.values()) {
          if (!byTenant.has(tid)) byTenant.set(tid, []);
          byTenant.get(tid)!.push(chatId);
        }
        for (const [tid, chatIds] of byTenant.entries()) {
          const matched = await ctx.db
            .select({ chatId: users.chatId, name: users.name, tgUsername: users.tgUsername })
            .from(users)
            .where(and(eq(users.tenantId, tid), inArray(users.chatId, chatIds)));
          for (const u of matched) {
            userMap.set(
              `${tid}:${u.chatId}`,
              u.name || (u.tgUsername ? `@${u.tgUsername}` : ""),
            );
          }
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

      // Batch-resolve user names — single IN-query replacing the old N+1 for-loop.
      const withUserId = rows
        .filter((r) => r.internalUserId)
        .map((r) => Number(r.internalUserId!));
      const uniqueChatIds = [...new Set(withUserId)];
      const userMap = new Map<number, string>();
      if (uniqueChatIds.length) {
        const matched = await ctx.db
          .select({ chatId: users.chatId, name: users.name, tgUsername: users.tgUsername })
          .from(users)
          .where(and(eq(users.tenantId, input.tenantId), inArray(users.chatId, uniqueChatIds)));
        for (const u of matched) {
          userMap.set(u.chatId, u.name || (u.tgUsername ? `@${u.tgUsername}` : ""));
        }
      }

      const items = rows.map((r) => ({
        ...r,
        displayName: r.internalUserId ? (userMap.get(Number(r.internalUserId)) ?? null) : null,
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
