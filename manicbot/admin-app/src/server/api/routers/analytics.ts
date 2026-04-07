/**
 * Salon-scoped analytics: user acquisition, conversion funnel, top campaigns.
 *
 * All procedures enforce `assertTenantOwner` — a salon owner can only query
 * their own tenant's data. Dashboards are small (typically < 30 days of data),
 * so we query live from `users` / `user_origins` / `appointments` without any
 * rollup table. If this starts to get slow, drop in a nightly rollup task
 * (see plan §7).
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { users, userOrigins, appointments } from "~/server/db/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { env } from "~/env";
import { encodeStartPayload } from "~/lib/trackingPayload";

const tenantDaysInput = z.object({
  tenantId: z.string(),
  days: z.number().int().min(7).max(365).default(30),
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export const analyticsRouter = createTRPCRouter({
  /**
   * Daily acquisition stacked by first_source for the given window.
   * Returns one row per (day, source) and the unique-sources list.
   */
  getAcquisition: publicProcedure
    .input(tenantDaysInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const since = nowSec() - input.days * 86400;

      const rows = await ctx.db
        .select({
          day: sql<string>`strftime('%Y-%m-%d', ${users.firstTouchAt}, 'unixepoch')`,
          source: sql<string>`coalesce(${users.firstSource}, 'direct')`,
          count: sql<number>`count(*)`,
        })
        .from(users)
        .where(
          and(
            eq(users.tenantId, input.tenantId),
            gte(users.firstTouchAt, since),
          ),
        )
        .groupBy(
          sql`strftime('%Y-%m-%d', ${users.firstTouchAt}, 'unixepoch')`,
          sql`coalesce(${users.firstSource}, 'direct')`,
        )
        .orderBy(sql`strftime('%Y-%m-%d', ${users.firstTouchAt}, 'unixepoch')`);

      // Build day axis filled with zeros so charts are continuous.
      type DailyRow = { date: string; total: number } & Record<string, number | string>;
      const dayMap = new Map<string, DailyRow>();
      for (let i = input.days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dayMap.set(key, { date: key, total: 0 });
      }

      const sources = new Set<string>();
      for (const r of rows) {
        if (!r.day) continue;
        const rec = dayMap.get(r.day);
        if (!rec) continue;
        const src = r.source || "direct";
        sources.add(src);
        rec[src] = ((rec[src] as number | undefined) ?? 0) + r.count;
        rec.total = (rec.total as number) + r.count;
      }

      const totalBySource: Record<string, number> = {};
      for (const src of sources) totalBySource[src] = 0;
      for (const row of dayMap.values()) {
        for (const src of sources) {
          totalBySource[src] = (totalBySource[src] ?? 0) + ((row[src] as number | undefined) ?? 0);
        }
      }

      return {
        daily: [...dayMap.values()],
        sources: [...sources].sort(),
        totalBySource,
        totalUsers: Object.values(totalBySource).reduce((s, n) => s + n, 0),
      };
    }),

  /**
   * Conversion funnel for new users who first touched in the window:
   *   touches → unique users → registered (phone captured) → booked → confirmed.
   */
  getFunnel: publicProcedure
    .input(tenantDaysInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const since = nowSec() - input.days * 86400;

      const [touchesRow, usersRow, registeredRow, bookedRow, confirmedRow] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(userOrigins)
          .where(
            and(
              eq(userOrigins.tenantId, input.tenantId),
              gte(userOrigins.capturedAt, since),
            ),
          ),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(
            and(
              eq(users.tenantId, input.tenantId),
              gte(users.firstTouchAt, since),
            ),
          ),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(
            and(
              eq(users.tenantId, input.tenantId),
              gte(users.firstTouchAt, since),
              sql`${users.phone} IS NOT NULL AND ${users.phone} != ''`,
            ),
          ),
        ctx.db
          .select({ count: sql<number>`count(distinct ${appointments.chatId})` })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              gte(appointments.createdAt, since),
            ),
          ),
        ctx.db
          .select({ count: sql<number>`count(distinct ${appointments.chatId})` })
          .from(appointments)
          .where(
            and(
              eq(appointments.tenantId, input.tenantId),
              gte(appointments.createdAt, since),
              eq(appointments.status, "confirmed"),
            ),
          ),
      ]);

      const touches = touchesRow[0]?.count ?? 0;
      const uniqueUsers = usersRow[0]?.count ?? 0;
      const registered = registeredRow[0]?.count ?? 0;
      const booked = bookedRow[0]?.count ?? 0;
      const confirmed = confirmedRow[0]?.count ?? 0;

      return {
        stages: [
          { key: "touches", label: "Касания", count: touches },
          { key: "users", label: "Уникальные", count: uniqueUsers },
          { key: "registered", label: "С телефоном", count: registered },
          { key: "booked", label: "Записались", count: booked },
          { key: "confirmed", label: "Подтверждено", count: confirmed },
        ],
      };
    }),

  /**
   * Top campaigns by booked-user count. Joins user_origins (first_touch only) to
   * appointments via chat_id — requires CREATE INDEX idx_uo_tenant_first.
   */
  getTopCampaigns: publicProcedure
    .input(tenantDaysInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const since = nowSec() - input.days * 86400;

      const rows = await ctx.db
        .select({
          source: sql<string>`coalesce(${users.firstSource}, 'direct')`,
          campaign: sql<string>`coalesce(${users.firstCampaign}, '')`,
          users: sql<number>`count(distinct ${users.chatId})`,
          bookings: sql<number>`count(distinct ${appointments.id})`,
        })
        .from(users)
        .leftJoin(
          appointments,
          and(
            eq(appointments.tenantId, users.tenantId),
            eq(appointments.chatId, users.chatId),
          ),
        )
        .where(
          and(
            eq(users.tenantId, input.tenantId),
            gte(users.firstTouchAt, since),
          ),
        )
        .groupBy(
          sql`coalesce(${users.firstSource}, 'direct')`,
          sql`coalesce(${users.firstCampaign}, '')`,
        )
        .orderBy(desc(sql`count(distinct ${appointments.id})`))
        .limit(20);

      return {
        campaigns: rows.map((r) => ({
          source: r.source,
          campaign: r.campaign || null,
          users: r.users,
          bookings: r.bookings,
          conversion: r.users > 0 ? Math.round((r.bookings / r.users) * 100) : 0,
        })),
      };
    }),

  /**
   * Returns ready-to-share tracking links for the given source/medium/campaign.
   * Encodes the payload on the server so the Worker's /start parser can decode
   * it without a lookup table. Fails if the generated token would exceed
   * Telegram's 64-char /start limit — caller should shorten the inputs.
   */
  buildTrackingLinks: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      source: z.string().min(1).max(64),
      medium: z.string().max(64).optional(),
      campaign: z.string().max(64).optional(),
      content: z.string().max(64).optional(),
      botUsername: z.string().optional(),
      slug: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      let token: string;
      try {
        token = encodeStartPayload({
          source: input.source,
          medium: input.medium,
          campaign: input.campaign,
          content: input.content,
        });
      } catch (e) {
        throw new Error(
          e instanceof Error
            ? e.message
            : "Failed to encode tracking token",
        );
      }
      const base = (env.WORKER_PUBLIC_URL ?? "https://manicbot.com").replace(/\/$/, "");
      const links: { label: string; url: string }[] = [];
      if (input.botUsername) {
        links.push({
          label: "Telegram",
          url: `https://t.me/${input.botUsername.replace(/^@/, "")}?start=${token}`,
        });
      }
      if (input.slug) {
        links.push({
          label: "Публичный профиль",
          url: `${base}/salon/${input.slug}?s=${encodeURIComponent(input.source)}${input.campaign ? `&c=${encodeURIComponent(input.campaign)}` : ""}`,
        });
      }
      return { token, links };
    }),
});
