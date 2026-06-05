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
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { users, userOrigins, appointments, trackingLinks } from "~/server/db/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { env } from "~/env";

const tenantDaysInput = z.object({
  tenantId: z.string(),
  days: z.number().int().min(7).max(365).default(30),
});

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 8-char lowercase-hex code for a tracking link (matches the Worker's /^[0-9a-f]{8}$/). */
function genShortCode(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Stable SHA-256 hex of the normalized attribution tuple — the idempotency key. */
async function hashTrackingPayload(
  source: string,
  medium: string | null,
  campaign: string | null,
  content: string | null,
): Promise<string> {
  const norm = [source, medium ?? "", campaign ?? "", content ?? ""].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const analyticsRouter = createTRPCRouter({
  /**
   * Daily first-touch acquisition by source for the given window, across ALL
   * channels (Telegram + web). Reads the unified `user_origins` ledger filtered
   * to first touches — `users.first_*` would be Telegram-only (web visits have no
   * Telegram chat_id, so they never produce a `users` row).
   * Returns one row per (day, source) and the unique-sources list.
   */
  getAcquisition: publicProcedure
    .input(tenantDaysInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const since = nowSec() - input.days * 86400;

      const rows = await ctx.db
        .select({
          day: sql<string>`strftime('%Y-%m-%d', ${userOrigins.capturedAt}, 'unixepoch')`,
          source: sql<string>`coalesce(${userOrigins.source}, 'direct')`,
          count: sql<number>`count(*)`,
        })
        .from(userOrigins)
        .where(
          and(
            eq(userOrigins.tenantId, input.tenantId),
            eq(userOrigins.isFirstTouch, 1),
            gte(userOrigins.capturedAt, since),
          ),
        )
        .groupBy(
          sql`strftime('%Y-%m-%d', ${userOrigins.capturedAt}, 'unixepoch')`,
          sql`coalesce(${userOrigins.source}, 'direct')`,
        )
        .orderBy(sql`strftime('%Y-%m-%d', ${userOrigins.capturedAt}, 'unixepoch')`);

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
          .select({
            count: sql<number>`count(distinct coalesce(${userOrigins.webUserId}, cast(${userOrigins.chatId} as text)))`,
          })
          .from(userOrigins)
          .where(
            and(
              eq(userOrigins.tenantId, input.tenantId),
              eq(userOrigins.isFirstTouch, 1),
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
   * Top campaigns by booked-user count, across ALL channels (Telegram + web).
   * Reads first-touch rows from the unified `user_origins` ledger and LEFT JOINs
   * appointments via chat_id — web touches use chat_id=0, so they correctly show
   * touches/visitors with zero bookings (a web visitor hasn't booked via Telegram
   * under that touch). Uses CREATE INDEX idx_uo_tenant_first.
   */
  getTopCampaigns: publicProcedure
    .input(tenantDaysInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const since = nowSec() - input.days * 86400;

      const rows = await ctx.db
        .select({
          source: sql<string>`coalesce(${userOrigins.source}, 'direct')`,
          campaign: sql<string>`coalesce(${userOrigins.campaign}, '')`,
          users: sql<number>`count(distinct coalesce(${userOrigins.webUserId}, cast(${userOrigins.chatId} as text)))`,
          bookings: sql<number>`count(distinct ${appointments.id})`,
        })
        .from(userOrigins)
        .leftJoin(
          appointments,
          and(
            eq(appointments.tenantId, userOrigins.tenantId),
            eq(appointments.chatId, userOrigins.chatId),
          ),
        )
        .where(
          and(
            eq(userOrigins.tenantId, input.tenantId),
            eq(userOrigins.isFirstTouch, 1),
            gte(userOrigins.capturedAt, since),
          ),
        )
        .groupBy(
          sql`coalesce(${userOrigins.source}, 'direct')`,
          sql`coalesce(${userOrigins.campaign}, '')`,
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
   * Mint (or reuse) a persisted short code for the given attribution and return
   * ready-to-share links. The Telegram link carries only the opaque short code
   * (e.g. `?start=ab12cd34`) — the Worker's /start handler looks it up — so the
   * campaign/medium/content can be any length or alphabet (Cyrillic included) and
   * never hits Telegram's 64-char /start limit. Idempotent per (tenant, payload):
   * re-generating the same meta returns the same code rather than spawning rows.
   */
  buildTrackingLinks: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      source: z.string().min(1).max(120),
      medium: z.string().max(120).optional(),
      campaign: z.string().max(120).optional(),
      content: z.string().max(120).optional(),
      botUsername: z.string().optional(),
      slug: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const source = input.source.trim();
      const medium = input.medium?.trim() || null;
      const campaign = input.campaign?.trim() || null;
      const content = input.content?.trim() || null;
      const payloadHash = await hashTrackingPayload(source, medium, campaign, content);

      // Create-or-get: one short code per (tenant, payload). Re-read after an
      // ON CONFLICT DO NOTHING insert so a concurrent insert of the same payload
      // resolves to the winner's code; a short_code PK collision (astronomically
      // rare) leaves the row absent → we retry with a fresh code.
      const findByHash = () =>
        ctx.db
          .select({ shortCode: trackingLinks.shortCode })
          .from(trackingLinks)
          .where(
            and(
              eq(trackingLinks.tenantId, input.tenantId),
              eq(trackingLinks.payloadHash, payloadHash),
            ),
          )
          .limit(1);

      let shortCode = (await findByHash())[0]?.shortCode;
      for (let attempt = 0; !shortCode && attempt < 5; attempt++) {
        const code = genShortCode();
        await ctx.db
          .insert(trackingLinks)
          .values({
            shortCode: code,
            tenantId: input.tenantId,
            source,
            medium,
            campaign,
            content,
            payloadHash,
            createdAt: nowSec(),
          })
          .onConflictDoNothing();
        shortCode = (await findByHash())[0]?.shortCode;
      }
      if (!shortCode) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not allocate a tracking code",
        });
      }

      const base = (env.WORKER_PUBLIC_URL ?? "https://manicbot.com").replace(/\/$/, "");
      const links: { label: string; url: string }[] = [];
      if (input.botUsername) {
        links.push({
          label: "Telegram",
          url: `https://t.me/${input.botUsername.replace(/^@/, "")}?start=${shortCode}`,
        });
      }
      if (input.slug) {
        const params = new URLSearchParams({ s: source });
        if (campaign) params.set("c", campaign);
        links.push({
          label: "Публичный профиль",
          url: `${base}/salon/${input.slug}?${params.toString()}`,
        });
      }
      return { shortCode, links };
    }),
});
