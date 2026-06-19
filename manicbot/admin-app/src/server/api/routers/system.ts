import { TRPCError } from "@trpc/server";
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
import { isResendConfigured, sendResendEmail } from "~/server/email/resend";
import { log } from "~/server/utils/logger";
import { ERD_MERMAID, ERD_META } from "~/server/_generated/erd.generated";

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

  /**
   * Send a self-test email through the configured Resend transport to the
   * currently-authenticated sysadmin. Surfaces three failure modes:
   *
   *   1. `configured: false`     — RESEND_API_KEY / RESEND_FROM unset on Pages.
   *   2. `ok: false`             — transport reached Resend but the API
   *                                rejected the call (bad key, unverified
   *                                domain, sender mismatch, rate limit).
   *   3. `ok: true`              — Resend accepted the message id. Delivery
   *                                still depends on DNS / inbox provider, but
   *                                anything past this is no longer a Pages
   *                                env-var problem.
   *
   * One-click cure for the silent-fail UX that motivated PR-A — operator
   * clicks the button in /system and immediately sees whether `email.transport_failed`
   * captures will start firing.
   */
  testResendTransport: adminProcedure.mutation(async ({ ctx }) => {
    const recipient = ctx.webUser?.email?.trim();
    if (!recipient) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "no_sysadmin_email_on_record",
      });
    }

    if (!isResendConfigured()) {
      return {
        ok: false as const,
        configured: false as const,
        sentTo: recipient,
        error: "resend_not_configured",
      };
    }

    const now = new Date().toISOString();
    const subject = "ManicBot — Resend transport self-test";
    const html = `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a;">
        <h2 style="margin:0 0 8px;font-size:18px;">Resend transport OK</h2>
        <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.5;">
          Это диагностическое сообщение от ManicBot.
          Если ты видишь его в своём ящике, значит <code>RESEND_API_KEY</code>
          и <code>RESEND_FROM</code> на Cloudflare Pages выставлены корректно
          и приглашения мастерам теперь дойдут до адресатов.
        </p>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Отправлено в ${now}.</p>
      </div>
    `;
    const text = `ManicBot — Resend transport OK\n\nЭто диагностическое сообщение. ${now}.`;

    try {
      const result = await sendResendEmail({
        to: recipient,
        subject,
        html,
        text,
      });
      if (!result.ok) {
        log.warn("system.testResendTransport.send_failed", { reason: result.error });
        return {
          ok: false as const,
          configured: true as const,
          sentTo: recipient,
          error: result.error,
        };
      }
      return {
        ok: true as const,
        configured: true as const,
        sentTo: recipient,
      };
    } catch (e) {
      log.warn(
        "system.testResendTransport.threw",
        e instanceof Error ? { message: e.message } : { raw: String(e) },
      );
      return {
        ok: false as const,
        configured: true as const,
        sentTo: recipient,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }),

  /**
   * God-Mode-only: return the auto-generated DB ERD as Mermaid text.
   *
   * The diagram is regenerated from `schema.sql` on every admin-app deploy
   * (CI step "Generate architecture ERD" → scripts/gen-erd.mjs) and embedded
   * into the server bundle. It is served ONLY through this `adminProcedure`,
   * so the architecture map never reaches non-admins and is never published to
   * the public repo. Payload carries table/column NAMES only — no secrets.
   */
  getArchitectureDiagram: adminProcedure.query(async () => {
    return {
      kind: "erd" as const,
      format: "mermaid" as const,
      mermaid: ERD_MERMAID,
      generatedAt: ERD_META.generatedAt,
      tableCount: ERD_META.tableCount,
      domainCount: ERD_META.domainCount,
      source: ERD_META.source,
    };
  }),
});
