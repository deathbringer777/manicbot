import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  appointments, masters, services, users, tenants, tenantConfig, localTickets, tenantRoles,
} from "~/server/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { buildMetaChannelHints } from "~/lib/metaChannelHints";

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

  /** URL вебхуков и verify token для настройки Meta (значения с сервера Pages — совпадают с Worker). */
  getMetaChannelHints: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return buildMetaChannelHints({
      workerPublicUrl: env.WORKER_PUBLIC_URL,
      waVerify: env.META_VERIFY_TOKEN_WA,
      igVerify: env.META_VERIFY_TOKEN_IG,
    });
  }),

  // ── Mutations ──────────────────────────────────────────────────────

  updateService: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      svcId: z.string(),
      price: z.number().optional(),
      duration: z.number().optional(),
      emoji: z.string().optional(),
      names: z.string().optional(),
      active: z.number().min(0).max(1).optional(),
      hidden: z.number().min(0).max(1).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const { tenantId, svcId, ...updates } = input;
      // Filter out undefined values
      const setObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) setObj[k] = v;
      }
      if (Object.keys(setObj).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }
      await ctx.db.update(services).set(setObj).where(
        and(eq(services.tenantId, tenantId), eq(services.svcId, svcId))
      );
      return { success: true };
    }),

  createService: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      emoji: z.string().optional(),
      duration: z.number(),
      price: z.number(),
      names: z.string(),
      description: z.string().optional(),
      active: z.number().min(0).max(1).default(1),
      hidden: z.number().min(0).max(1).default(0),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const svcId = `svc_${Date.now()}`;
      await ctx.db.insert(services).values({
        tenantId: input.tenantId,
        svcId,
        emoji: input.emoji ?? null,
        duration: input.duration,
        price: input.price,
        names: input.names,
        description: input.description ?? null,
        active: input.active,
        hidden: input.hidden,
        sortOrder: input.sortOrder,
      });
      return { svcId };
    }),

  deleteService: publicProcedure
    .input(z.object({ tenantId: z.string(), svcId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Soft-delete: mark as hidden + inactive rather than removing data
      await ctx.db.update(services).set({ active: 0, hidden: 1 }).where(
        and(eq(services.tenantId, input.tenantId), eq(services.svcId, input.svcId))
      );
      return { success: true };
    }),

  updateSalonProfile: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      name: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      workHours: z.string().optional(),
      workHoursFrom: z.number().int().optional(),
      workHoursTo: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // 1. Update tenants.salon JSON field and tenants.name
      const tenantRow = await ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenantRow.length) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });

      const existing = tenantRow[0]!.salon ? JSON.parse(tenantRow[0]!.salon!) : {};
      if (input.address !== undefined) existing.address = input.address;
      if (input.phone !== undefined) existing.phone = input.phone;
      if (input.workHours !== undefined) existing.workHours = input.workHours;
      if (input.workHoursFrom !== undefined || input.workHoursTo !== undefined) {
        const wh =
          typeof existing.workHours === "object" && existing.workHours !== null
            ? { ...existing.workHours }
            : {};
        if (input.workHoursFrom !== undefined) wh.from = input.workHoursFrom;
        if (input.workHoursTo !== undefined) wh.to = input.workHoursTo;
        existing.workHours = wh;
      }

      const tenantUpdate: Record<string, unknown> = { salon: JSON.stringify(existing) };
      if (input.name !== undefined) tenantUpdate.name = input.name;
      await ctx.db.update(tenants).set(tenantUpdate).where(eq(tenants.id, input.tenantId));

      // 2. Upsert tenant_config rows for each provided field
      const workHoursConfig =
        input.workHours ??
        (input.workHoursFrom !== undefined || input.workHoursTo !== undefined
          ? JSON.stringify(existing.workHours ?? {})
          : undefined);

      const configMap: Record<string, string | undefined> = {
        salon_name: input.name,
        address: input.address,
        phone: input.phone,
        work_hours: workHoursConfig,
      };
      for (const [key, value] of Object.entries(configMap)) {
        if (value === undefined) continue;
        await ctx.db.insert(tenantConfig)
          .values({ tenantId: input.tenantId, key, value })
          .onConflictDoUpdate({ target: [tenantConfig.tenantId, tenantConfig.key], set: { value } });
      }

      return { success: true };
    }),

  updateAppointmentStatus: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      appointmentId: z.string(),
      status: z.enum(["confirmed", "cancelled", "rejected"]),
      cancelReason: z.string().optional(),
      rejectComment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const row = await ctx.db.select().from(appointments)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!row.length) throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });

      const setObj: Record<string, unknown> = { status: input.status };
      if (input.status === "cancelled") {
        setObj.cancelled = 1;
        if (input.cancelReason) setObj.cancelReason = input.cancelReason;
      }
      if (input.status === "rejected" && input.rejectComment) {
        setObj.rejectComment = input.rejectComment;
      }
      if (input.status === "confirmed") {
        setObj.confirmedBy = ctx.user?.id ?? null;
      }

      await ctx.db.update(appointments).set(setObj).where(eq(appointments.id, input.appointmentId));

      // Fire-and-forget: notify Worker to send Telegram message + sync calendar
      const workerUrl = env.WORKER_PUBLIC_URL;
      const adminKey = env.ADMIN_KEY;
      if (workerUrl && adminKey) {
        fetch(`${workerUrl}/admin/appointment-action?key=${encodeURIComponent(adminKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: input.status, appointmentId: input.appointmentId, tenantId: input.tenantId, confirmedBy: setObj.confirmedBy ?? null }),
        }).catch(e => console.error("[salon] Worker notification error:", e.message));
      }

      return { success: true };
    }),

  addMaster: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number(),
      name: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Check if master already exists for this tenant
      const existing = await ctx.db.select().from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.chatId)))
        .limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Master already exists in this salon" });
      }
      await ctx.db.insert(masters).values({
        tenantId: input.tenantId,
        chatId: input.chatId,
        name: input.name,
      });
      // Also assign tenant_roles entry so master can access the mini-app
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(tenantRoles)
        .values({ tenantId: input.tenantId, chatId: input.chatId, role: "master", createdAt: now })
        .onConflictDoUpdate({ target: [tenantRoles.tenantId, tenantRoles.chatId], set: { role: "master", createdAt: now } });
      return { success: true };
    }),

  removeMaster: publicProcedure
    .input(z.object({ tenantId: z.string(), chatId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.delete(masters).where(
        and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.chatId))
      );
      // Remove tenant role as well
      await ctx.db.delete(tenantRoles).where(
        and(eq(tenantRoles.tenantId, input.tenantId), eq(tenantRoles.chatId, input.chatId), eq(tenantRoles.role, "master"))
      );
      return { success: true };
    }),
});
