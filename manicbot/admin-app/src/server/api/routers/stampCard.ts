/**
 * Stamp card config router (Sprint 4).
 *
 * One config row per tenant. When enabled, post-visit confirmation flow
 * increments stamp_card_progress.visits_completed and emits an analytics
 * event when the Nth visit reward is earned.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { stampCardConfigs, stampCardProgress } from "~/server/db/schema";
import { eq, and, desc } from "drizzle-orm";

const nowSec = () => Math.floor(Date.now() / 1000);

export const stampCardRouter = createTRPCRouter({
  getConfig: publicProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(stampCardConfigs)
        .where(eq(stampCardConfigs.tenantId, input.tenantId))
        .limit(1);
      return rows[0] ?? {
        tenantId: input.tenantId,
        enabled: 0,
        visitsRequired: 5,
        rewardType: "free_service",
        rewardValue: null,
        serviceIds: null,
        updatedAt: 0,
      };
    }),

  updateConfig: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      enabled: z.boolean(),
      visitsRequired: z.number().int().min(2).max(30),
      rewardType: z.enum(["free_service", "percent_off", "fixed_off"]),
      rewardValue: z.number().int().min(0).max(10_000).nullable().optional(),
      serviceIds: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const values = {
        tenantId: input.tenantId,
        enabled: input.enabled ? 1 : 0,
        visitsRequired: input.visitsRequired,
        rewardType: input.rewardType,
        rewardValue: input.rewardValue ?? null,
        serviceIds: input.serviceIds ? JSON.stringify(input.serviceIds) : null,
        updatedAt: nowSec(),
      };
      const existing = await ctx.db
        .select({ tenantId: stampCardConfigs.tenantId })
        .from(stampCardConfigs)
        .where(eq(stampCardConfigs.tenantId, input.tenantId))
        .limit(1);
      if (existing[0]) {
        await ctx.db
          .update(stampCardConfigs)
          .set(values)
          .where(eq(stampCardConfigs.tenantId, input.tenantId));
      } else {
        await ctx.db.insert(stampCardConfigs).values(values);
      }
      return { ok: true };
    }),

  /** Top clients by visit count — for stamp card dashboards. */
  topProgress: publicProcedure
    .input(z.object({ tenantId: z.string(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      return ctx.db
        .select()
        .from(stampCardProgress)
        .where(eq(stampCardProgress.tenantId, input.tenantId))
        .orderBy(desc(stampCardProgress.visitsCompleted))
        .limit(input.limit);
    }),

  resetClient: publicProcedure
    .input(z.object({ tenantId: z.string(), clientId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .delete(stampCardProgress)
        .where(and(
          eq(stampCardProgress.tenantId, input.tenantId),
          eq(stampCardProgress.clientId, input.clientId),
        ));
      return { ok: true };
    }),
});
