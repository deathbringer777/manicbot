import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { users, platformRoles, blockedUsers } from "~/server/db/schema";
import { eq, inArray, and, asc, sql, or, like } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { timingSafeEqualStr } from "~/server/auth/telegram";

export const usersRouter = createTRPCRouter({
  getAll: adminProcedure
    .input(
      z.object({
        offset: z.number().default(0),
        limit: z.number().min(1).max(200).default(50),
        search: z.string().optional(),
        filter: z.enum(["all", "admins", "banned"]).default("all"),
        tenantId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Build WHERE conditions
      const conditions = [];
      if (input.tenantId) {
        conditions.push(eq(users.tenantId, input.tenantId));
      }
      if (input.search) {
        const q = `%${input.search.toLowerCase()}%`;
        conditions.push(
          or(
            like(sql`lower(${users.name})`, q),
            like(sql`lower(${users.tgUsername})`, q),
            like(users.phone, q),
            like(sql`CAST(${users.chatId} AS TEXT)`, q),
          )!,
        );
      }

      // For "admins" filter, get the set of admin chatIds first
      let adminChatIds: number[] = [];
      if (input.filter === "admins") {
        const roles = await ctx.db.select({ chatId: platformRoles.chatId }).from(platformRoles);
        adminChatIds = roles.map((r) => r.chatId);
        if (adminChatIds.length === 0) return { users: [], total: 0 };
        conditions.push(inArray(users.chatId, adminChatIds));
      }

      // For "banned" filter, get banned chatIds first
      let bannedChatIdSet = new Set<number>();
      if (input.filter === "banned") {
        const banned = await ctx.db.select({ chatId: blockedUsers.chatId }).from(blockedUsers);
        const bannedIds = banned.map((b) => b.chatId);
        if (bannedIds.length === 0) return { users: [], total: 0 };
        bannedChatIdSet = new Set(bannedIds);
        conditions.push(inArray(users.chatId, bannedIds));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Count unique users (for pagination total)
      const countResult = await ctx.db
        .select({ count: sql<number>`COUNT(DISTINCT ${users.chatId})` })
        .from(users)
        .where(where);
      const total = countResult[0]?.count ?? 0;

      if (total === 0) return { users: [], total: 0 };

      // Get distinct chatIds with pagination (ordered by name)
      const distinctRows = await ctx.db
        .select({
          chatId: users.chatId,
          name: sql<string>`MIN(${users.name})`,
          tgUsername: sql<string | null>`MIN(${users.tgUsername})`,
          phone: sql<string | null>`MIN(${users.phone})`,
          tgLang: sql<string | null>`MIN(${users.tgLang})`,
          registeredAt: sql<number | null>`MIN(${users.registeredAt})`,
        })
        .from(users)
        .where(where)
        .groupBy(users.chatId)
        .orderBy(asc(sql`MIN(${users.name})`))
        .limit(input.limit)
        .offset(input.offset);

      const chatIds = distinctRows.map((r) => r.chatId);
      if (chatIds.length === 0) return { users: [], total };

      // Fetch tenants, roles, and bans in parallel
      const [tenantRows, roles, banned] = await Promise.all([
        ctx.db.select({ chatId: users.chatId, tenantId: users.tenantId })
          .from(users).where(inArray(users.chatId, chatIds)),
        ctx.db.select().from(platformRoles).where(inArray(platformRoles.chatId, chatIds)),
        input.filter === "banned"
          ? Promise.resolve([] as { chatId: number }[])
          : ctx.db.select({ chatId: blockedUsers.chatId }).from(blockedUsers).where(inArray(blockedUsers.chatId, chatIds)),
      ]);

      const userRoles: Record<number, string> = Object.fromEntries(roles.map((r) => [r.chatId, r.role]));
      if (input.filter !== "banned") {
        bannedChatIdSet = new Set(banned.map((b) => b.chatId));
      }

      // Group tenant IDs per user
      const tenantMap = new Map<number, string[]>();
      for (const t of tenantRows) {
        const arr = tenantMap.get(t.chatId) || [];
        arr.push(t.tenantId);
        tenantMap.set(t.chatId, arr);
      }

      const result = distinctRows.map((row) => ({
        id: row.chatId,
        name: row.name ?? "Неизвестный",
        username: row.tgUsername ? `@${row.tgUsername}` : null,
        phone: row.phone ?? null,
        lang: row.tgLang ?? null,
        role: userRoles[row.chatId] ?? "user",
        isBanned: bannedChatIdSet.has(row.chatId),
        tenants: tenantMap.get(row.chatId) || [],
        joinedAt: row.registeredAt
          ? new Date(row.registeredAt * 1000).toLocaleDateString("ru-RU")
          : "Неизвестно",
        registeredAt: row.registeredAt ?? 0,
      }));

      return { users: result, total };
    }),

  // Ban user globally (from all their tenants)
  banUser: adminProcedure
    .input(z.object({ chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Get all tenants this user belongs to
      const userRows = await ctx.db
        .select({ tenantId: users.tenantId })
        .from(users)
        .where(eq(users.chatId, input.chatId));

      for (const row of userRows) {
        await ctx.db
          .insert(blockedUsers)
          .values({ tenantId: row.tenantId, chatId: input.chatId })
          .onConflictDoNothing();
      }
      return { success: true, tenantsAffected: userRows.length };
    }),

  // Unban user globally (from all their tenants)
  unbanUser: adminProcedure
    .input(z.object({ chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(blockedUsers)
        .where(eq(blockedUsers.chatId, input.chatId));
      return { success: true };
    }),

  setRole: adminProcedure
    .input(
      z.object({ chatId: z.number(), role: z.enum(["support", "technical_support"]) })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(platformRoles)
        .values({
          chatId: input.chatId,
          role: input.role,
          createdAt: Math.floor(Date.now() / 1000),
        })
        .onConflictDoUpdate({
          target: platformRoles.chatId,
          set: { role: input.role },
        });
      return { success: true };
    }),

  removeRole: adminProcedure
    .input(z.object({ chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (
        env.ADMIN_CHAT_ID &&
        timingSafeEqualStr(String(input.chatId), env.ADMIN_CHAT_ID)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot remove platform owner role.",
        });
      }
      await ctx.db.delete(platformRoles).where(eq(platformRoles.chatId, input.chatId));
      return { success: true };
    }),
});
