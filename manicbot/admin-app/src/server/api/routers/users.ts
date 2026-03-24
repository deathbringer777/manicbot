import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { users, platformRoles, blockedUsers } from "~/server/db/schema";
import { eq, inArray, and, asc } from "drizzle-orm";
import { z } from "zod";

export const usersRouter = createTRPCRouter({
  getAll: adminProcedure
    .input(
      z.object({
        offset: z.number().default(0),
        limit: z.number().default(50),
        search: z.string().optional(),
        filter: z.enum(["all", "admins", "banned"]).default("all"),
        tenantId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get all user rows, sorted by name
      const allRows = await ctx.db
        .select()
        .from(users)
        .orderBy(asc(users.name))
        .limit(1000);

      // Filter to a specific tenant first if requested
      const rows = input.tenantId
        ? allRows.filter((u) => u.tenantId === input.tenantId)
        : allRows;

      const uniqueIds = [...new Set(rows.map((u) => u.chatId))];

      let userRoles: Record<number, string> = {};
      let bannedChatIds = new Set<number>();

      if (uniqueIds.length > 0) {
        const [roles, banned] = await Promise.all([
          ctx.db
            .select()
            .from(platformRoles)
            .where(inArray(platformRoles.chatId, uniqueIds)),
          ctx.db
            .select()
            .from(blockedUsers)
            .where(inArray(blockedUsers.chatId, uniqueIds)),
        ]);
        userRoles = Object.fromEntries(roles.map((r) => [r.chatId, r.role]));
        banned.forEach((b) => bannedChatIds.add(b.chatId));
      }

      // Group by chatId — one entry per unique user
      const grouped = new Map<
        number,
        {
          id: number;
          name: string;
          username: string | null;
          phone: string | null;
          lang: string | null;
          role: string;
          isBanned: boolean;
          tenants: string[];
          joinedAt: string;
          registeredAt: number;
        }
      >();

      for (const row of rows) {
        if (grouped.has(row.chatId)) {
          grouped.get(row.chatId)!.tenants.push(row.tenantId);
        } else {
          grouped.set(row.chatId, {
            id: row.chatId,
            name: row.name ?? "Неизвестный",
            username: row.tgUsername ? `@${row.tgUsername}` : null,
            phone: row.phone ?? null,
            lang: row.tgLang ?? null,
            role: userRoles[row.chatId] ?? "user",
            isBanned: bannedChatIds.has(row.chatId),
            tenants: [row.tenantId],
            joinedAt: row.registeredAt
              ? new Date(row.registeredAt * 1000).toLocaleDateString("ru-RU")
              : "Неизвестно",
            registeredAt: row.registeredAt ?? 0,
          });
        }
      }

      let result = Array.from(grouped.values());

      // Search
      if (input.search) {
        const s = input.search.toLowerCase();
        result = result.filter(
          (u) =>
            u.name.toLowerCase().includes(s) ||
            u.username?.toLowerCase().includes(s) ||
            String(u.id).includes(s) ||
            u.phone?.includes(s)
        );
      }

      // Filter
      if (input.filter === "admins") {
        result = result.filter((u) => u.role === "system_admin" || u.role === "support");
      }
      if (input.filter === "banned") {
        result = result.filter((u) => u.isBanned);
      }

      // Sort by name
      result.sort((a, b) => a.name.localeCompare(b.name, "ru"));

      return {
        users: result.slice(input.offset, input.offset + input.limit),
        total: result.length,
      };
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
      z.object({ chatId: z.number(), role: z.enum(["system_admin", "support"]) })
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
      await ctx.db.delete(platformRoles).where(eq(platformRoles.chatId, input.chatId));
      return { success: true };
    }),
});
