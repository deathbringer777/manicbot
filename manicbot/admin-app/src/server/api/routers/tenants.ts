import { createTRPCRouter, adminProcedure } from "~/server/api/trpc";
import { tenants, bots, users, appointments, services, masters } from "~/server/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const tenantsRouter = createTRPCRouter({
  getAll: adminProcedure.query(async ({ ctx }) => {
    const allTenants = await ctx.db
      .select()
      .from(tenants)
      .orderBy(desc(tenants.createdAt));

    const [allBots, userCounts, aptCounts, masterCounts] = await Promise.all([
      ctx.db.select().from(bots),
      ctx.db
        .select({ tenantId: users.tenantId, count: sql<number>`count(*)` })
        .from(users)
        .groupBy(users.tenantId),
      ctx.db
        .select({ tenantId: appointments.tenantId, count: sql<number>`count(*)` })
        .from(appointments)
        .where(eq(appointments.cancelled, 0))
        .groupBy(appointments.tenantId),
      ctx.db
        .select({ tenantId: masters.tenantId, count: sql<number>`count(*)` })
        .from(masters)
        .groupBy(masters.tenantId),
    ]);

    const botMap = Object.fromEntries(allBots.map((b) => [b.tenantId, b]));
    const userMap = Object.fromEntries(userCounts.map((u) => [u.tenantId, u.count]));
    const aptMap = Object.fromEntries(aptCounts.map((a) => [a.tenantId, a.count]));
    const masterMap = Object.fromEntries(masterCounts.map((m) => [m.tenantId, m.count]));

    return allTenants.map((t) => ({
      ...t,
      bot: botMap[t.id] ?? null,
      userCount: userMap[t.id] ?? 0,
      appointmentCount: aptMap[t.id] ?? 0,
      masterCount: masterMap[t.id] ?? 0,
    }));
  }),

  getById: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [tenant, bot, userCount, aptCount, svcList, masterList] = await Promise.all([
        ctx.db.select().from(tenants).where(eq(tenants.id, input.id)).limit(1),
        ctx.db.select().from(bots).where(eq(bots.tenantId, input.id)).limit(1),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.tenantId, input.id)),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(appointments)
          .where(and(eq(appointments.tenantId, input.id), eq(appointments.cancelled, 0))),
        ctx.db.select().from(services).where(eq(services.tenantId, input.id)),
        ctx.db.select().from(masters).where(eq(masters.tenantId, input.id)),
      ]);

      if (!tenant[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });

      return {
        ...tenant[0],
        bot: bot[0] ?? null,
        userCount: userCount[0]?.count ?? 0,
        appointmentCount: aptCount[0]?.count ?? 0,
        services: svcList,
        masters: masterList,
      };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string(),
        active: z.number().optional(),
        plan: z.string().optional(),
        billingStatus: z.string().optional(),
        name: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await ctx.db
        .update(tenants)
        .set({ ...data, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(tenants.id, id));
      return { success: true };
    }),

  deactivate: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tenants)
        .set({ active: 0, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(tenants.id, input.id));
      return { success: true };
    }),

  activate: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(tenants)
        .set({ active: 1, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(tenants.id, input.id));
      return { success: true };
    }),
});
