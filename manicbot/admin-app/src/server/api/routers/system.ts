import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import {
  users,
  tenants,
  appointments,
  bots,
  services,
  platformRoles,
  blockedUsers,
  platformTickets,
  masters,
  localTickets,
  auditLog,
  channelConfigs,
  conversations,
  webUsers,
  supportAgents,
} from "~/server/db/schema";
import { sql, eq, desc } from "drizzle-orm";

const TABLE_LIST = [
  { name: "tenants", table: tenants },
  { name: "users", table: users },
  { name: "appointments", table: appointments },
  { name: "bots", table: bots },
  { name: "services", table: services },
  { name: "masters", table: masters },
  { name: "platform_roles", table: platformRoles },
  { name: "blocked_users", table: blockedUsers },
  { name: "platform_tickets", table: platformTickets },
  { name: "local_tickets", table: localTickets },
  { name: "channel_configs", table: channelConfigs },
  { name: "conversations", table: conversations },
  { name: "web_users", table: webUsers },
  { name: "support_agents", table: supportAgents },
] as const;

export const systemRouter = createTRPCRouter({
  getHealth: adminProcedure.query(async ({ ctx }) => {
    try {
      const start = Date.now();
      await ctx.db.select({ count: sql<number>`count(*)` }).from(tenants);
      const latency = Date.now() - start;
      return { status: "ok" as const, dbConnected: true, dbLatencyMs: latency };
    } catch (e) {
      return { status: "error" as const, dbConnected: false, dbLatencyMs: 0 };
    }
  }),

  getTableStats: adminProcedure.query(async ({ ctx }) => {
    const counts = await Promise.all(
      TABLE_LIST.map(async ({ name, table }) => {
        try {
          const result = await ctx.db
            .select({ count: sql<number>`count(*)` })
            .from(table as any);
          return { table: name, rows: result[0]?.count ?? 0 };
        } catch {
          return { table: name, rows: -1 };
        }
      })
    );

    const totalRows = counts.reduce((s, c) => s + (c.rows > 0 ? c.rows : 0), 0);
    return { tables: counts, totalRows };
  }),

  getConsentLog: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "tos_accepted"))
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return rows;
  }),

  getEnvStatus: adminProcedure.query(async ({ ctx }) => {
    // Count connected channels by type
    let channelCounts: { telegram: number; whatsapp: number; instagram: number } = { telegram: 0, whatsapp: 0, instagram: 0 };
    try {
      const channels = await ctx.db.select({ channelType: channelConfigs.channelType }).from(channelConfigs);
      for (const ch of channels) {
        if (ch.channelType === "whatsapp") channelCounts.whatsapp++;
        else if (ch.channelType === "instagram") channelCounts.instagram++;
      }
      const botCount = await ctx.db.select({ count: sql<number>`count(*)` }).from(bots);
      channelCounts.telegram = botCount[0]?.count ?? 0;
    } catch { /* ignore */ }

    // Count web users and support agents
    let webUserCount = 0;
    let agentCount = 0;
    try {
      const wc = await ctx.db.select({ count: sql<number>`count(*)` }).from(webUsers);
      webUserCount = wc[0]?.count ?? 0;
      const ac = await ctx.db.select({ count: sql<number>`count(*)` }).from(supportAgents);
      agentCount = ac[0]?.count ?? 0;
    } catch { /* ignore */ }

    return {
      hasWorkerUrl: !!(env as any).WORKER_PUBLIC_URL,
      hasAdminKey: !!(env as any).ADMIN_KEY,
      hasAdminChatId: !!(env as any).ADMIN_CHAT_ID,
      hasStripeKey: !!(env as any).STRIPE_SECRET_KEY,
      hasResendKey: !!(env as any).RESEND_API_KEY,
      hasTelegramToken: !!(env as any).TELEGRAM_BOT_TOKEN,
      channelCounts,
      webUserCount,
      agentCount,
    };
  }),
});
