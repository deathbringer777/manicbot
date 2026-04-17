/**
 * Tenant onboarding checklist router (Sprint 3).
 *
 * Tracks which onboarding steps a tenant owner has completed. Steps auto-mark
 * when the user takes the underlying action (add service, connect bot, etc.);
 * this router just reads + sometimes manually marks.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { tenantOnboarding } from "~/server/db/schema";
import { eq, sql } from "drizzle-orm";

const STEP_IDS = [
  "add_service",
  "connect_bot",
  "invite_master",
  "set_schedule",
  "share_link",
  "first_booking",
] as const;
type StepId = (typeof STEP_IDS)[number];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export const onboardingRouter = createTRPCRouter({
  getStatus: publicProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(tenantOnboarding)
        .where(eq(tenantOnboarding.tenantId, input.tenantId))
        .limit(1);
      const row = rows[0];
      const completed: StepId[] = row ? JSON.parse(row.completedSteps) : [];
      return {
        completedSteps: completed,
        allCompletedAt: row?.allCompletedAt ?? null,
        totalSteps: STEP_IDS.length,
      };
    }),

  markStep: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      stepId: z.enum(STEP_IDS),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(tenantOnboarding)
        .where(eq(tenantOnboarding.tenantId, input.tenantId))
        .limit(1);
      const now = nowSec();
      const existing: StepId[] = rows[0] ? JSON.parse(rows[0].completedSteps) : [];
      if (existing.includes(input.stepId)) {
        return { ok: true, alreadyCompleted: true };
      }
      const newSteps = [...existing, input.stepId];
      const allDone = STEP_IDS.every(s => newSteps.includes(s));
      if (rows[0]) {
        await ctx.db
          .update(tenantOnboarding)
          .set({
            completedSteps: JSON.stringify(newSteps),
            allCompletedAt: allDone ? now : null,
            updatedAt: now,
          })
          .where(eq(tenantOnboarding.tenantId, input.tenantId));
      } else {
        await ctx.db
          .insert(tenantOnboarding)
          .values({
            tenantId: input.tenantId,
            completedSteps: JSON.stringify(newSteps),
            allCompletedAt: allDone ? now : null,
            createdAt: now,
            updatedAt: now,
          });
      }
      return { ok: true, completed: newSteps, allDone };
    }),
});
