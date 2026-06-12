/**
 * Tenant onboarding checklist router.
 *
 * 2026-05-27 rework: the legacy 10-id checklist
 *   (add_service / connect_bot / invite_master / set_schedule / share_link /
 *    first_booking / fill_description / add_logo / add_cover / activate_public)
 * was reshaped into a 4-essential + 4-optional split. Driver: a tenant
 * cannot take a booking through the Telegram bot without:
 *   1. a connected bot,
 *   2. at least one master,
 *   3. that master having work hours,
 *   4. at least one service.
 * Everything else (description, logo, cover, public toggle, sharing) only
 * affects the public /salon/{slug} page. `first_booking` was vanity (a
 * counter, not a setup gate) and is dropped. `add_logo` + `add_cover` were
 * merged into `add_branding` (AND of both — a public card with only one of
 * the two looks broken).
 *
 * Steps auto-mark when the user takes the underlying action; this router
 * just reads + manually marks `share_link` (the only step without a
 * derivable D1 signal).
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { tenantOnboarding, services, bots, masters, tenants } from "~/server/db/schema";
import { eq, sql, and, isNotNull, ne } from "drizzle-orm";

export const ESSENTIAL_STEP_IDS = [
  "connect_bot",
  "add_master",
  "set_master_schedule",
  "add_service",
] as const;

export const OPTIONAL_STEP_IDS = [
  "fill_salon_info",
  "add_branding",
  "activate_public",
  "share_link",
] as const;

const STEP_IDS = [...ESSENTIAL_STEP_IDS, ...OPTIONAL_STEP_IDS] as const;
type StepId = (typeof STEP_IDS)[number];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export const onboardingRouter = createTRPCRouter({
  getStatus: protectedProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const tid = input.tenantId;

      // Derive completed steps from real tenant data in parallel.
      // share_link is manually marked via markStep (no D1 signal — fires when
      // the user clicks the "copy link" button).
      const [svcRows, botRows, masterRows, manualRow, tenantRow] = await Promise.all([
        ctx.db.select({ n: sql<number>`count(*)` }).from(services)
          .where(and(eq(services.tenantId, tid), eq(services.active, 1))),
        ctx.db.select({ n: sql<number>`count(*)` }).from(bots)
          .where(eq(bots.tenantId, tid)),
        ctx.db.select({ n: sql<number>`count(*)` }).from(masters)
          .where(and(eq(masters.tenantId, tid), eq(masters.active, 1))),
        ctx.db.select().from(tenantOnboarding)
          .where(eq(tenantOnboarding.tenantId, tid)).limit(1),
        ctx.db.select({
          description: tenants.description,
          logo: tenants.logo,
          coverPhoto: tenants.coverPhoto,
          publicActive: tenants.publicActive,
        }).from(tenants).where(eq(tenants.id, tid)).limit(1),
      ]);

      // Pre-2026-05-27 the persisted JSON may contain dropped ids
      // (first_booking, invite_master, set_schedule, fill_description,
      // add_logo, add_cover). We only ever look at "share_link" so the rest
      // is silently ignored — no D1 cleanup needed.
      const manualSteps: string[] = manualRow[0] ? JSON.parse(manualRow[0].completedSteps) : [];

      // set_master_schedule: any active master has workHours configured.
      const scheduleRows = await ctx.db.select({ n: sql<number>`count(*)` }).from(masters)
        .where(and(
          eq(masters.tenantId, tid),
          eq(masters.active, 1),
          isNotNull(masters.workHours),
          ne(masters.workHours, ""),
          ne(masters.workHours, "{}"),
          ne(masters.workHours, "null"),
        ));

      const tenantInfo = tenantRow[0];
      const hasNonEmpty = (v: string | null | undefined) => !!(v && v.trim().length > 0);

      const completed: StepId[] = [];
      if ((botRows[0]?.n ?? 0) > 0) completed.push("connect_bot");
      if ((masterRows[0]?.n ?? 0) > 0) completed.push("add_master");
      if ((scheduleRows[0]?.n ?? 0) > 0) completed.push("set_master_schedule");
      if ((svcRows[0]?.n ?? 0) > 0) completed.push("add_service");

      if (hasNonEmpty(tenantInfo?.description)) completed.push("fill_salon_info");
      // add_branding: AND of logo + cover. One without the other leaves the
      // public card visually broken, so the step only flips ON when both
      // are uploaded.
      if (hasNonEmpty(tenantInfo?.logo) && hasNonEmpty(tenantInfo?.coverPhoto)) {
        completed.push("add_branding");
      }
      if ((tenantInfo?.publicActive ?? 0) === 1) completed.push("activate_public");
      if (manualSteps.includes("share_link")) completed.push("share_link");

      const allDone = STEP_IDS.every(s => completed.includes(s));
      // Honor the server-persisted ready-dismiss only while the salon stays
      // booking-ready (4/4 essentials). If an essential later regresses the
      // checklist resurfaces as a warning; the stored timestamp is preserved
      // and the bar hides again automatically once readiness is restored.
      const allEssentialsDone = ESSENTIAL_STEP_IDS.every(s => completed.includes(s));
      const readyDismissed = allEssentialsDone && !!manualRow[0]?.readyDismissedAt;
      return {
        completedSteps: completed,
        allCompletedAt: allDone ? (manualRow[0]?.allCompletedAt ?? null) : null,
        totalSteps: STEP_IDS.length,
        readyDismissed,
      };
    }),
  markStep: protectedProcedure
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

  /**
   * Persist (or clear) the owner's dismissal of the 4/4-ready onboarding bar.
   * tenantOwnerProcedure gates the role; assertTenantOwner scopes it to the
   * caller's own tenant. Stores a timestamp (not a bool) so we keep a record
   * of WHEN readiness was acknowledged.
   */
  setReadyDismissed: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      dismissed: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(tenantOnboarding)
        .where(eq(tenantOnboarding.tenantId, input.tenantId))
        .limit(1);
      const now = nowSec();
      const ts = input.dismissed ? now : null;
      if (rows[0]) {
        await ctx.db
          .update(tenantOnboarding)
          .set({ readyDismissedAt: ts, updatedAt: now })
          .where(eq(tenantOnboarding.tenantId, input.tenantId));
      } else {
        await ctx.db
          .insert(tenantOnboarding)
          .values({
            tenantId: input.tenantId,
            completedSteps: "[]",
            readyDismissedAt: ts,
            createdAt: now,
            updatedAt: now,
          });
      }
      return { ok: true, readyDismissed: input.dismissed };
    }),
});
