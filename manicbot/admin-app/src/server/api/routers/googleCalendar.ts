/**
 * tRPC router for Google Calendar integrations.
 * Allows tenant owners to view connected calendars, toggle sync, and disconnect.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { env } from "~/env";
import { appointments, bots, googleBusyBlocks, googleIntegrations, masters } from "~/server/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const googleCalendarRouter = createTRPCRouter({
  /**
   * List all Google Calendar integrations for a tenant,
   * joined with master names for display.
   */
  list: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({
          id: googleIntegrations.id,
          scope: googleIntegrations.scope,
          masterChatId: googleIntegrations.masterChatId,
          providerAccountEmail: googleIntegrations.providerAccountEmail,
          calendarId: googleIntegrations.calendarId,
          calendarSummary: googleIntegrations.calendarSummary,
          syncEnabled: googleIntegrations.syncEnabled,
          syncDirection: googleIntegrations.syncDirection,
          lastSyncAt: googleIntegrations.lastSyncAt,
          lastSyncStatus: googleIntegrations.lastSyncStatus,
          lastSyncError: googleIntegrations.lastSyncError,
          createdAt: googleIntegrations.createdAt,
          updatedAt: googleIntegrations.updatedAt,
        })
        .from(googleIntegrations)
        .where(eq(googleIntegrations.tenantId, input.tenantId));

      // Enrich with master names
      const masterChatIds = rows
        .map((r) => r.masterChatId)
        .filter((id): id is number => id != null);
      let masterMap: Record<number, string> = {};
      if (masterChatIds.length > 0) {
        const masterRows = await ctx.db
          .select({ chatId: masters.chatId, name: masters.name })
          .from(masters)
          .where(eq(masters.tenantId, input.tenantId));
        masterMap = Object.fromEntries(
          masterRows.map((m) => [m.chatId, m.name ?? `Master #${m.chatId}`])
        );
      }

      return rows.map((r) => ({
        ...r,
        syncEnabled: r.syncEnabled === 1,
        masterName: r.masterChatId ? (masterMap[r.masterChatId] ?? `#${r.masterChatId}`) : null,
      }));
    }),

  /**
   * Mini-app keeps OAuth initiation inside the salon bot, where the Worker
   * can mint the short-lived signed session in KV.
   */
  getConnectInfo: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const botRows = await ctx.db
        .select({
          botId: bots.botId,
          botUsername: bots.botUsername,
        })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .orderBy(desc(bots.updatedAt), desc(bots.createdAt))
        .limit(1);

      const bot = botRows[0] ?? null;
      const botUsername = bot?.botUsername?.replace(/^@/, "") || null;

      return {
        botId: bot?.botId ?? null,
        botUsername,
        botLink: botUsername ? `https://t.me/${botUsername}` : null,
      };
    }),

  /**
   * Compact status for the plugin SettingsPanel — avoids sending full integration list
   * when the panel only needs to render connected / disconnected state.
   */
  getStatus: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({
          id: googleIntegrations.id,
          providerAccountEmail: googleIntegrations.providerAccountEmail,
          calendarId: googleIntegrations.calendarId,
          calendarSummary: googleIntegrations.calendarSummary,
          syncEnabled: googleIntegrations.syncEnabled,
          lastSyncAt: googleIntegrations.lastSyncAt,
          lastSyncStatus: googleIntegrations.lastSyncStatus,
          lastSyncError: googleIntegrations.lastSyncError,
        })
        .from(googleIntegrations)
        .where(and(eq(googleIntegrations.tenantId, input.tenantId), eq(googleIntegrations.scope, "tenant")))
        .orderBy(desc(googleIntegrations.updatedAt))
        .limit(1);
      const row = rows[0];
      if (!row) return { connected: false as const };
      return {
        connected: true as const,
        integrationId: row.id,
        email: row.providerAccountEmail,
        calendarId: row.calendarId,
        calendarSummary: row.calendarSummary,
        syncEnabled: row.syncEnabled === 1,
        lastSyncAt: row.lastSyncAt,
        lastSyncStatus: row.lastSyncStatus,
        lastSyncError: row.lastSyncError,
      };
    }),

  /**
   * Mint a web-mode OAuth connect URL by proxying to the Worker's
   * /admin/google/oauth-url endpoint (ADMIN_KEY-gated).
   */
  createWebConnectUrl: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        scope: z.enum(["tenant", "master"]).default("tenant"),
        masterChatId: z.number().optional(),
        returnUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const workerUrl = (env.WORKER_PUBLIC_URL ?? "").replace(/\/$/, "");
      const adminKey = env.ADMIN_KEY ?? "";
      if (!workerUrl || !adminKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "WORKER_PUBLIC_URL / ADMIN_KEY not set on admin-app — cannot mint Google OAuth URL.",
        });
      }
      const res = await fetch(`${workerUrl}/admin/google/oauth-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({
          tenantId: input.tenantId,
          scope: input.scope,
          masterChatId: input.masterChatId ?? null,
          returnUrl: input.returnUrl ?? null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { connectUrl?: string; error?: string };
      if (!res.ok || !data.connectUrl) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: data.error || `Worker returned ${res.status} when minting OAuth URL`,
        });
      }
      return { connectUrl: data.connectUrl };
    }),

  /**
   * Toggle sync_enabled for an integration.
   */
  toggleSync: protectedProcedure
    .input(
      z.object({
        tenantId: z.string(),
        integrationId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = Date.now();
      await ctx.db
        .update(googleIntegrations)
        .set({ syncEnabled: input.enabled ? 1 : 0, updatedAt: now })
        .where(
          and(
            eq(googleIntegrations.id, input.integrationId),
            eq(googleIntegrations.tenantId, input.tenantId)
          )
        );
      return { ok: true };
    }),

  /**
   * Delete an integration (disconnect).
   * WARNING: does NOT revoke the OAuth refresh token at Google — that requires the Worker's
   * encryption key to decrypt the token. The token remains valid until it expires or the user
   * revokes ManicBot access in their Google Account settings.
   */
  disconnect: protectedProcedure
    .input(z.object({ tenantId: z.string(), integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({
          id: googleIntegrations.id,
          scope: googleIntegrations.scope,
          masterChatId: googleIntegrations.masterChatId,
        })
        .from(googleIntegrations)
        .where(
          and(
            eq(googleIntegrations.id, input.integrationId),
            eq(googleIntegrations.tenantId, input.tenantId)
          )
        )
        .limit(1);
      const integration = rows[0] ?? null;
      if (!integration) return { ok: false };

      await ctx.db
        .update(appointments)
        .set({
          googleIntegrationId: null,
          googleCalendarId: null,
          googleEventId: null,
        })
        .where(
          and(
            eq(appointments.tenantId, input.tenantId),
            eq(appointments.googleIntegrationId, input.integrationId)
          )
        );

      await ctx.db
        .delete(googleBusyBlocks)
        .where(
          and(
            eq(googleBusyBlocks.integrationId, input.integrationId),
            eq(googleBusyBlocks.tenantId, input.tenantId)
          )
        );

      await ctx.db
        .delete(googleIntegrations)
        .where(
          and(
            eq(googleIntegrations.id, input.integrationId),
            eq(googleIntegrations.tenantId, input.tenantId)
          )
        );

      if (integration.scope === "master" && integration.masterChatId != null) {
        await ctx.db
          .update(masters)
          .set({
            googleCalendarId: null,
            calendarEnabled: 0,
          })
          .where(
            and(
              eq(masters.tenantId, input.tenantId),
              eq(masters.chatId, integration.masterChatId)
            )
          );
      }

      return { ok: true };
    }),
});
