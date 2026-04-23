import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { tenants } from "~/server/db/schema";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { PLAN_PRICES_PLN } from "~/lib/money";
import { writeAudit, ctxIp } from "~/server/security/audit";

export const billingRouter = createTRPCRouter({
  getOverview: adminProcedure.query(async ({ ctx }) => {
    const allTenants = await ctx.db.select().from(tenants).orderBy(desc(tenants.createdAt));

    const active = allTenants.filter((t) => t.billingStatus === "active");
    const trialing = allTenants.filter((t) => t.billingStatus === "trialing");
    const grace = allTenants.filter((t) => t.billingStatus === "grace_period");
    const inactive = allTenants.filter(
      (t) => !t.billingStatus || t.billingStatus === "inactive"
    );

    const mrr = active.reduce(
      (sum, t) => sum + (PLAN_PRICES_PLN[t.plan ?? "start"] ?? 0),
      0
    );

    const planBreakdown: Record<string, number> = {};
    active.forEach((t) => {
      const plan = t.plan ?? "start";
      planBreakdown[plan] = (planBreakdown[plan] ?? 0) + 1;
    });

    return {
      metrics: {
        mrr,
        totalTenants: allTenants.length,
        activeSubscribers: active.length,
        trialing: trialing.length,
        grace: grace.length,
        inactive: inactive.length,
        planBreakdown,
      },
      tenants: allTenants.map((t) => ({
        id: t.id,
        name: t.name,
        plan: t.plan ?? "start",
        billingStatus: t.billingStatus ?? "inactive",
        email: t.billingEmail,
        stripeCustomerId: t.stripeCustomerId,
        stripeSubscriptionId: t.stripeSubscriptionId,
        trialEndsAt: t.trialEndsAt,
        currentPeriodEnd: t.currentPeriodEnd,
        cancelAtPeriodEnd: t.cancelAtPeriodEnd,
        createdAt: t.createdAt,
        monthlyRevenue:
          t.billingStatus === "active" ? (PLAN_PRICES_PLN[t.plan ?? "start"] ?? 0) : 0,
      })),
    };
  }),

  updatePlan: adminProcedure
    .input(
      z.object({
        tenantId: z.string(),
        plan: z.enum(["start", "pro", "max"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tenants)
        .set({ plan: input.plan, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(tenants.id, input.tenantId));
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "billing.updatePlan",
        tenantId: input.tenantId,
        detail: `plan=${input.plan}`,
        ip: ctxIp(ctx),
      });
      return { success: true };
    }),

  updateStatus: adminProcedure
    .input(
      z.object({
        tenantId: z.string(),
        billingStatus: z.enum(["active", "trialing", "grace_period", "inactive"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tenants)
        .set({
          billingStatus: input.billingStatus,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(tenants.id, input.tenantId));
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "billing.updateStatus",
        tenantId: input.tenantId,
        detail: `status=${input.billingStatus}`,
        ip: ctxIp(ctx),
      });
      return { success: true };
    }),

  manualActivate: adminProcedure
    .input(
      z
        .object({
          tenantId: z.string(),
          plan: z.enum(["start", "pro", "max"]),
          months: z.number().int().min(1).max(24).optional(),
          days: z.number().int().min(1).max(3650).optional(),
        })
        .refine((v) => (v.months == null) !== (v.days == null), {
          message: "Provide exactly one of months or days",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const now = Math.floor(Date.now() / 1000);
      const seconds = input.days != null ? input.days * 86400 : input.months! * 30 * 86400;
      const periodEnd = now + seconds;

      await ctx.db
        .update(tenants)
        .set({
          plan: input.plan,
          billingStatus: "active",
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
          graceEndsAt: null,
          cancelAtPeriodEnd: 0,
          updatedAt: now,
        })
        .where(eq(tenants.id, input.tenantId));

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "billing.manualActivate",
        tenantId: input.tenantId,
        detail: `plan=${input.plan} periodEnd=${periodEnd}`,
        ip: ctxIp(ctx),
      });
      return { success: true, periodEnd };
    }),
});
