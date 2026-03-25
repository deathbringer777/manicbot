import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { appointments, masters, users, services, tenantRoles } from "~/server/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

async function assertMaster(ctx: any, tenantId: string) {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  const row = await ctx.db
    .select()
    .from(tenantRoles)
    .where(and(eq(tenantRoles.tenantId, tenantId), eq(tenantRoles.chatId, ctx.user.id)))
    .limit(1);
  if (!row.length || (row[0]!.role !== "master" && row[0]!.role !== "tenant_owner")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Master access required" });
  }
}

export const masterRouter = createTRPCRouter({
  getMySchedule: publicProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const today = new Date().toISOString().slice(0, 10);
      return ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
          eq(appointments.date, today),
        ))
        .orderBy(appointments.time);
    }),

  getMyAppointments: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const rows = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
          ...(input.dateFrom ? [gte(appointments.date, input.dateFrom)] : []),
          ...(input.dateTo ? [lte(appointments.date, input.dateTo)] : []),
        ))
        .orderBy(desc(appointments.ts))
        .limit(200);
      return rows;
    }),

  getMyEarnings: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const rows = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
          eq(appointments.status, "confirmed"),
          ...(input.dateFrom ? [gte(appointments.date, input.dateFrom)] : []),
          ...(input.dateTo ? [lte(appointments.date, input.dateTo)] : []),
        ));
      // Get service prices
      const svcRows = await ctx.db.select().from(services).where(eq(services.tenantId, input.tenantId));
      const priceMap = Object.fromEntries(svcRows.map((s: any) => [s.svcId, s.price]));
      const total = rows.reduce((sum: number, a: any) => sum + (priceMap[a.svcId] ?? 0), 0);
      return { total, count: rows.length };
    }),

  getMyClients: publicProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const apts = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.masterId, input.masterId),
        ))
        .orderBy(desc(appointments.ts));
      // Unique client chat IDs with last appointment
      const seen = new Map<number, any>();
      for (const a of apts) {
        if (!seen.has(a.chatId)) seen.set(a.chatId, a);
      }
      const clientIds = Array.from(seen.keys());
      if (!clientIds.length) return [];
      const clientRows = await ctx.db.select().from(users)
        .where(eq(users.tenantId, input.tenantId));
      const clientMap = Object.fromEntries(clientRows.map((u: any) => [u.chatId, u]));
      return clientIds.map(id => ({
        ...clientMap[id],
        lastAppointment: seen.get(id),
      }));
    }),

  getMyProfile: publicProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const row = await ctx.db.select().from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)))
        .limit(1);
      return row[0] ?? null;
    }),
});
