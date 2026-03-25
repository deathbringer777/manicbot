import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  appointments, masters, services, users, tenants, tenantConfig, localTickets, tenantRoles,
} from "~/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Verify caller is tenant_owner for the given tenantId
async function assertTenantOwner(ctx: any, tenantId: string) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const row = await ctx.db
    .select()
    .from(tenantRoles)
    .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.chatId, ctx.user.id)))
    .limit(1);
  if (!row.length || row[0]!.role !== "tenant_owner") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Salon owner access required" });
  }
}

const tenantIdInput = z.object({ tenantId: z.string() });

export const salonRouter = createTRPCRouter({
  getOverview: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    const [aptRows, masterRows, ticketRows, tenantRow] = await Promise.all([
      ctx.db.select().from(appointments)
        .where(and(eq(appointments.tenantId, input.tenantId), eq(appointments.date, today))),
      ctx.db.select().from(masters).where(eq(masters.tenantId, input.tenantId)),
      ctx.db.select().from(localTickets)
        .where(and(eq(localTickets.tenantId, input.tenantId), eq(localTickets.open, 1))),
      ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
    ]);

    const todayApts = aptRows.filter((a: any) => !a.cancelled);
    return {
      todayAppointments: todayApts.length,
      activeMasters: masterRows.length,
      openTickets: ticketRows.length,
      plan: tenantRow[0]?.plan ?? "start",
      billingStatus: tenantRow[0]?.billingStatus ?? "trialing",
    };
  }),

  getAppointments: publicProcedure
    .input(z.object({ tenantId: z.string(), date: z.string().optional(), status: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          ...(input.date ? [eq(appointments.date, input.date)] : []),
          ...(input.status ? [eq(appointments.status, input.status)] : []),
        ))
        .orderBy(desc(appointments.ts))
        .limit(100);
      return rows;
    }),

  getMasters: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return ctx.db.select().from(masters).where(eq(masters.tenantId, input.tenantId));
  }),

  getServices: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return ctx.db.select().from(services)
      .where(eq(services.tenantId, input.tenantId))
      .orderBy(services.sortOrder);
  }),

  getClients: publicProcedure
    .input(z.object({ tenantId: z.string(), search: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db.select().from(users).where(eq(users.tenantId, input.tenantId)).limit(200);
      if (input.search) {
        const q = input.search.toLowerCase();
        return rows.filter((u: any) =>
          u.name?.toLowerCase().includes(q) ||
          u.tgUsername?.toLowerCase().includes(q) ||
          u.phone?.includes(q)
        );
      }
      return rows;
    }),

  getSalonProfile: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const [tenantRow, configRows] = await Promise.all([
      ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
      ctx.db.select().from(tenantConfig).where(eq(tenantConfig.tenantId, input.tenantId)),
    ]);
    const cfg = Object.fromEntries(configRows.map((r: any) => [r.key, r.value]));
    return {
      name: tenantRow[0]?.name ?? "",
      salon: tenantRow[0]?.salon ? JSON.parse(tenantRow[0].salon) : {},
      config: cfg,
    };
  }),

  getBillingStatus: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const row = await ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
    if (!row.length) throw new TRPCError({ code: "NOT_FOUND" });
    const t = row[0]!;
    return {
      plan: t.plan,
      billingStatus: t.billingStatus,
      subscriptionStatus: t.subscriptionStatus,
      trialEndsAt: t.trialEndsAt,
      graceEndsAt: t.graceEndsAt,
      currentPeriodEnd: t.currentPeriodEnd,
      nextPaymentDate: t.nextPaymentDate,
      cancelAtPeriodEnd: t.cancelAtPeriodEnd,
    };
  }),
});
