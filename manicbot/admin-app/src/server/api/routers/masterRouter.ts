import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { appointments, masters, users, services, tenants } from "~/server/db/schema";
import { eq, and, gte, lte, desc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/** Assert caller is master on a personal (independent) tenant — allows service/config management */
async function assertPersonalMaster(ctx: any, tenantId: string) {
  await assertMaster(ctx, tenantId);
  if (ctx.webUser?.webRole === "system_admin") return;
  const [t] = await ctx.db.select({ isPersonal: tenants.isPersonal }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!t?.isPersonal) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Service management is only available for independent masters" });
  }
}

async function assertMaster(ctx: any, tenantId: string) {
  if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
  const r = ctx.webUser.webRole;
  if (r === "system_admin") return;
  if ((r === "master" || r === "tenant_owner") && ctx.webUser.tenantId === tenantId) return;
  throw new TRPCError({ code: "FORBIDDEN", message: "Master access required" });
}

export const masterRouter = createTRPCRouter({
  getMastersForOwner: publicProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      return ctx.db
        .select({
          chatId: masters.chatId,
          name: masters.name,
          allowDelegation: masters.allowDelegation,
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.active, 1)));
    }),

  updateDelegation: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      allowDelegation: z.number().min(0).max(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // Only the master themselves can change this setting (not the owner, not the admin)
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (ctx.webUser.webRole !== "master" || ctx.webUser.tenantId !== input.tenantId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the master can change delegation setting" });
      }
      await ctx.db.update(masters)
        .set({ allowDelegation: input.allowDelegation })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),


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
        .where(and(eq(users.tenantId, input.tenantId), inArray(users.chatId, clientIds)));
      const clientMap = Object.fromEntries(clientRows.map((u: any) => [u.chatId, u]));
      return clientIds.map(id => ({
        ...clientMap[id],
        lastAppointment: seen.get(id),
      }));
    }),

  markNoShow: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      noShowBy: z.enum(["client", "master"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      await ctx.db.update(appointments).set({
        noShow: 1,
        noShowBy: input.noShowBy,
        status: "no_show",
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      return { success: true };
    }),

  getMyProfile: publicProcedure
    .input(z.object({ tenantId: z.string(), masterId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const row = await ctx.db.select().from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)))
        .limit(1);
      if (!row[0]) return null;
      const m = row[0];
      let portfolio: string[] = [];
      try { portfolio = m.portfolio ? JSON.parse(m.portfolio) : []; } catch { /* ignore */ }
      return { ...m, portfolio };
    }),

  updateProfile: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      bio: z.string().max(500).optional(),
      photo: z.string().url().optional().or(z.literal("")),
      portfolio: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const setObj: Record<string, unknown> = {};
      if (input.bio !== undefined) setObj.bio = input.bio || null;
      if (input.portfolio !== undefined) {
        setObj.portfolio = JSON.stringify(input.portfolio);
        // Keep masters.photo in sync with first portfolio entry for backward compat
        setObj.photo = input.portfolio[0] ?? null;
      } else if (input.photo !== undefined) {
        setObj.photo = input.photo || null;
      }
      if (Object.keys(setObj).length === 0) return { success: true };
      await ctx.db.update(masters)
        .set(setObj)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),

  // ── Service management for independent (personal tenant) masters ──

  getMyServices: publicProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      return ctx.db.select().from(services)
        .where(eq(services.tenantId, input.tenantId))
        .orderBy(services.sortOrder);
    }),

  createService: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      emoji: z.string().optional(),
      duration: z.number(),
      price: z.number(),
      names: z.string(),
      description: z.string().optional(),
      photos: z.string().optional(),
      promo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertPersonalMaster(ctx, input.tenantId);
      const svcId = `svc_${Date.now()}`;
      await ctx.db.insert(services).values({
        tenantId: input.tenantId,
        svcId,
        emoji: input.emoji ?? null,
        duration: input.duration,
        price: input.price,
        names: input.names,
        description: input.description ?? null,
        photos: input.photos ?? null,
        promo: input.promo ?? null,
        active: 1,
        hidden: 0,
        sortOrder: 0,
      });
      return { svcId };
    }),

  updateService: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      svcId: z.string(),
      price: z.number().optional(),
      duration: z.number().optional(),
      emoji: z.string().optional(),
      names: z.string().optional(),
      active: z.number().min(0).max(1).optional(),
      description: z.string().optional(),
      photos: z.string().optional(),
      promo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertPersonalMaster(ctx, input.tenantId);
      const { tenantId, svcId, ...updates } = input;
      const setObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) setObj[k] = v;
      }
      if (Object.keys(setObj).length === 0) return { success: true };
      await ctx.db.update(services).set(setObj).where(
        and(eq(services.tenantId, tenantId), eq(services.svcId, svcId))
      );
      return { success: true };
    }),

  deleteService: publicProcedure
    .input(z.object({ tenantId: z.string(), svcId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertPersonalMaster(ctx, input.tenantId);
      await ctx.db.update(services).set({ active: 0, hidden: 1 }).where(
        and(eq(services.tenantId, input.tenantId), eq(services.svcId, input.svcId))
      );
      return { success: true };
    }),

  /** Update work hours for independent master */
  updateWorkHours: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      masterId: z.number(),
      workHours: z.string().optional(),
      workDays: z.string().optional(),
      onVacation: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertMaster(ctx, input.tenantId);
      const setObj: Record<string, unknown> = {};
      if (input.workHours !== undefined) setObj.workHours = input.workHours;
      if (input.workDays !== undefined) setObj.workDays = input.workDays;
      if (input.onVacation !== undefined) setObj.onVacation = input.onVacation;
      if (Object.keys(setObj).length === 0) return { success: true };
      await ctx.db.update(masters).set(setObj)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterId)));
      return { success: true };
    }),
});
