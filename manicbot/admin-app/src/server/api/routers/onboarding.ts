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
import { tenantOnboarding, services, bots, masters, appointments } from "~/server/db/schema";
import { eq, sql, and, isNotNull, ne } from "drizzle-orm";

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
      const tid = input.tenantId;

      // Derive completed steps from real tenant data in parallel.
      // share_link uses markStep (manual — triggered when user copies/shares the link).
      const [svcRows, botRows, masterRows, aptRows, manualRow] = await Promise.all([
        ctx.db.select({ n: sql<number>`count(*)` }).from(services)
          .where(and(eq(services.tenantId, tid), eq(services.active, 1))),
        ctx.db.select({ n: sql<number>`count(*)` }).from(bots)
          .where(eq(bots.tenantId, tid)),
        ctx.db.select({ n: sql<number>`count(*)` }).from(masters)
          .where(and(eq(masters.tenantId, tid), eq(masters.active, 1))),
        ctx.db.select({ n: sql<number>`count(*)` }).from(appointments)
          .where(eq(appointments.tenantId, tid)),
        ctx.db.select().from(tenantOnboarding)
          .where(eq(tenantOnboarding.tenantId, tid)).limit(1),
      ]);

      const manualSteps: StepId[] = manualRow[0] ? JSON.parse(manualRow[0].completedSteps) : [];

      // set_schedule: any master has workHours configured
      const scheduleRows = await ctx.db.select({ n: sql<number>`count(*)` }).from(masters)
        .where(and(
          eq(masters.tenantId, tid),
          eq(masters.active, 1),
          isNotNull(masters.workHours),
          ne(masters.workHours, ""),
          ne(masters.workHours, "{}"),
          ne(masters.workHours, "null"),
        ));

      const completed: StepId[] = [];
      if ((svcRows[0]?.n ?? 0) > 0) completed.push("add_service");
      if ((botRows[0]?.n ?? 0) > 0) completed.push("connect_bot");
      if ((masterRows[0]?.n ?? 0) > 0) completed.push("invite_master");
      if ((scheduleRows[0]?.n ?? 0) > 0) completed.push("set_schedule");
      if (manualSteps.includes("share_link")) completed.push("share_link");
      if ((aptRows[0]?.n ?? 0) > 0) completed.push("first_booking");

      const allDone = STEP_IDS.every(s => completed.includes(s));
      return {
        completedSteps: completed,
        allCompletedAt: allDone ? (manualRow[0]?.allCompletedAt ?? null) : null,
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
