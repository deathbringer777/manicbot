/**
 * tRPC router for Google Calendar integrations.
 * Allows tenant owners to view connected calendars, toggle sync, and disconnect.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { googleIntegrations, masters } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";

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
        masterName: r.masterChatId ? (masterMap[r.masterChatId] ?? `#${r.masterChatId}`) : null,
      }));
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
      const now = Math.floor(Date.now() / 1000);
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
   * Note: does NOT revoke OAuth token — that requires the Worker's google-calendar-oauth service.
   */
  disconnect: protectedProcedure
    .input(z.object({ tenantId: z.string(), integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .delete(googleIntegrations)
        .where(
          and(
            eq(googleIntegrations.id, input.integrationId),
            eq(googleIntegrations.tenantId, input.tenantId)
          )
        );
      return { ok: true };
    }),
});
