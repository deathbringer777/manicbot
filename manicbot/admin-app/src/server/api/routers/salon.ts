import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  appointments, masters, services, users, tenants, tenantConfig, localTickets, tenantRoles, bots, channelConfigs,
} from "~/server/db/schema";
import { telegramGetMe, telegramSetWebhook, telegramDeleteWebhook } from "~/server/lib/telegramApi";
import { getOrCreateCustomer, createCheckoutSession, createBillingPortalSession } from "~/server/lib/stripe";
import { eq, and, desc, sql, ne, like, or } from "drizzle-orm";
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
      const baseWhere = eq(users.tenantId, input.tenantId);
      if (input.search) {
        const q = `%${input.search.toLowerCase()}%`;
        return ctx.db.select().from(users)
          .where(and(baseWhere, or(
            like(sql`lower(${users.name})`, q),
            like(sql`lower(${users.tgUsername})`, q),
            like(users.phone, q),
          )))
          .limit(200);
      }
      return ctx.db.select().from(users).where(baseWhere).limit(200);
    }),

  getSalonProfile: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const [tenantRow, configRows] = await Promise.all([
      ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
      ctx.db.select().from(tenantConfig).where(eq(tenantConfig.tenantId, input.tenantId)),
    ]);
    const cfg = Object.fromEntries(configRows.map((r: any) => [r.key, r.value]));
    let salon = {};
    try { salon = tenantRow[0]?.salon ? JSON.parse(tenantRow[0].salon) : {}; } catch { /* ignore malformed JSON */ }
    return {
      name: tenantRow[0]?.name ?? "",
      salon,
      config: cfg,
      slug: tenantRow[0]?.slug ?? null,
      description: tenantRow[0]?.description ?? null,
      city: tenantRow[0]?.city ?? null,
      lat: tenantRow[0]?.lat ?? null,
      lng: tenantRow[0]?.lng ?? null,
      publicActive: tenantRow[0]?.publicActive ?? 0,
      photos: tenantRow[0]?.photos ? (() => { try { return JSON.parse(tenantRow[0]!.photos!); } catch { return []; } })() : [],
      logo: tenantRow[0]?.logo ?? null,
      coverPhoto: tenantRow[0]?.coverPhoto ?? null,
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
      stripeCustomerId: t.stripeCustomerId ?? null,
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

  markNoShow: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      noShowBy: z.enum(["client", "master"]),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(appointments).set({
        noShow: 1,
        noShowBy: input.noShowBy,
        status: "no_show",
        cancelReason: input.comment ?? null,
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      return { success: true };
    }),

  cancelAppointment: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      cancelledBy: z.enum(["client", "master", "admin"]),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(appointments).set({
        cancelled: 1,
        cancelledBy: input.cancelledBy,
        cancelledAt: Math.floor(Date.now() / 1000),
        status: "cancelled",
        cancelReason: input.comment ?? null,
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      return { success: true };
    }),

  checkSlugAvailable: publicProcedure
    .input(z.object({ slug: z.string(), tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!input.slug) return { available: true };
      const row = await ctx.db
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.slug, input.slug), ne(tenants.id, input.tenantId)))
        .limit(1);
      return { available: row.length === 0 };
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
      // Public profile fields
      slug: z.string().regex(/^[a-z0-9-]+$/, "Только строчные латинские буквы, цифры и дефис").optional(),
      description: z.string().max(1000).optional(),
      city: z.string().max(100).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      publicActive: z.number().min(0).max(1).optional(),
      photos: z.array(z.string()).optional(),
      logo: z.string().url().optional().or(z.literal("")),
      coverPhoto: z.string().url().optional().or(z.literal("")),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // 1. Update tenants.salon JSON field and tenants.name
      const tenantRow = await ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenantRow.length) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });

      let existing: Record<string, unknown> = {};
      try { existing = tenantRow[0]!.salon ? JSON.parse(tenantRow[0]!.salon!) : {}; } catch { /* ignore malformed JSON */ }
      if (input.address !== undefined) existing.address = input.address;
      if (input.phone !== undefined) existing.phone = input.phone;
      if (input.workHours !== undefined) existing.workHours = input.workHours;
      if (input.workHoursFrom !== undefined || input.workHoursTo !== undefined) {
        const wh: Record<string, unknown> =
          typeof existing.workHours === "object" && existing.workHours !== null
            ? { ...(existing.workHours as Record<string, unknown>) }
            : {};
        if (input.workHoursFrom !== undefined) wh.from = input.workHoursFrom;
        if (input.workHoursTo !== undefined) wh.to = input.workHoursTo;
        existing.workHours = wh;
      }

      const tenantUpdate: Record<string, unknown> = { salon: JSON.stringify(existing) };
      if (input.name !== undefined) tenantUpdate.name = input.name;
      if (input.slug !== undefined) tenantUpdate.slug = input.slug || null;
      if (input.description !== undefined) tenantUpdate.description = input.description || null;
      if (input.city !== undefined) tenantUpdate.city = input.city || null;
      if (input.lat !== undefined) tenantUpdate.lat = input.lat;
      if (input.lng !== undefined) tenantUpdate.lng = input.lng;
      if (input.publicActive !== undefined) tenantUpdate.publicActive = input.publicActive;
      if (input.photos !== undefined) tenantUpdate.photos = JSON.stringify(input.photos);
      if (input.logo !== undefined) tenantUpdate.logo = input.logo || null;
      if (input.coverPhoto !== undefined) tenantUpdate.coverPhoto = input.coverPhoto || null;
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

  // ── Bot Connection ─────────────────────────────────────────────

  getBotStatus: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const rows = await ctx.db
      .select()
      .from(bots)
      .where(eq(bots.tenantId, input.tenantId))
      .limit(1);
    if (!rows.length) return null;
    const bot = rows[0]!;
    return {
      botId: bot.botId,
      botUsername: bot.botUsername,
      active: !!bot.active,
    };
  }),

  connectBot: publicProcedure
    .input(z.object({ tenantId: z.string(), token: z.string().min(10).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Check no existing bot
      const existing = await ctx.db
        .select({ botId: bots.botId })
        .from(bots)
        .where(eq(bots.tenantId, input.tenantId))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Bot already connected. Disconnect first." });
      }

      // Validate token with Telegram
      let botInfo;
      try {
        botInfo = await telegramGetMe(input.token);
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message?.includes("401")
            ? "Invalid bot token. Check the token from BotFather."
            : `Could not validate token: ${err.message}`,
        });
      }

      const botId = String(botInfo.id);
      const webhookSecret = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      // Check bot not used by another tenant
      const otherTenant = await ctx.db
        .select({ tenantId: bots.tenantId })
        .from(bots)
        .where(eq(bots.botId, botId))
        .limit(1);
      if (otherTenant.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "This bot is already connected to another salon." });
      }

      // Set webhook
      const webhookUrl = `https://manicbot.com/webhook/${botId}`;
      try {
        await telegramSetWebhook(input.token, webhookUrl, webhookSecret);
      } catch (err: any) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set webhook: ${err.message}` });
      }

      // Register bot in D1
      await ctx.db.insert(bots).values({
        botId,
        tenantId: input.tenantId,
        botUsername: botInfo.username ?? null,
        webhookSecret,
        active: 1,
        createdAt: now,
        updatedAt: now,
      });

      return {
        botId,
        botUsername: botInfo.username ?? null,
        firstName: botInfo.first_name,
      };
    }),

  disconnectBot: publicProcedure.input(tenantIdInput).mutation(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const rows = await ctx.db
      .select()
      .from(bots)
      .where(eq(bots.tenantId, input.tenantId))
      .limit(1);
    if (!rows.length) return { success: true };

    // Remove from D1 (KV token cleanup is Worker-side)
    await ctx.db.delete(bots).where(eq(bots.botId, rows[0]!.botId));

    return { success: true };
  }),

  // ── Stripe Billing ─────────────────────────────────────────────

  getPlans: publicProcedure.query(() => {
    return [
      {
        id: "start",
        name: "Start",
        price: 45,
        currency: "PLN",
        masters: 1,
        popular: false,
        subtitle: {
          ru: "Для частного мастера",
          ua: "Для приватного майстра",
          en: "For solo professionals",
          pl: "Dla prywatnego mistrza",
        },
        featureList: {
          ru: [
            "1 мастер",
            "Запись через Telegram, Instagram и WhatsApp",
            "Синхронизация с Google Calendar",
            "Напоминания клиентам перед визитом",
            "4 языка интерфейса",
            "Панель управления на любом устройстве",
          ],
          ua: [
            "1 майстер",
            "Запис через Telegram, Instagram та WhatsApp",
            "Синхронізація з Google Calendar",
            "Нагадування клієнтам перед візитом",
            "4 мови інтерфейсу",
            "Панель керування на будь-якому пристрої",
          ],
          en: [
            "1 specialist",
            "Booking via Telegram, Instagram & WhatsApp",
            "Google Calendar sync",
            "Client reminders before appointments",
            "4 interface languages",
            "Dashboard on any device",
          ],
          pl: [
            "1 mistrz",
            "Rezerwacja przez Telegram, Instagram i WhatsApp",
            "Synchronizacja z Google Calendar",
            "Przypomnienia dla klientów przed wizytą",
            "4 języki interfejsu",
            "Panel na każdym urządzeniu",
          ],
        },
      },
      {
        id: "pro",
        name: "Pro",
        price: 60,
        currency: "PLN",
        masters: 5,
        popular: true,
        subtitle: {
          ru: "Для салона с командой",
          ua: "Для салону з командою",
          en: "For salons with a team",
          pl: "Dla salonu z zespołem",
        },
        featureList: {
          ru: [
            "До 5 мастеров",
            "Все каналы: Telegram, Instagram, WhatsApp",
            "ИИ-помощник по записи",
            "Запись на естественном языке",
            "Умные напоминания и уведомления",
            "Приоритетная поддержка",
          ],
          ua: [
            "До 5 майстрів",
            "Усі канали: Telegram, Instagram, WhatsApp",
            "ІІ-помічник із запису",
            "Запис природною мовою",
            "Розумні нагадування та сповіщення",
            "Пріоритетна підтримка",
          ],
          en: [
            "Up to 5 specialists",
            "All channels: Telegram, Instagram, WhatsApp",
            "AI booking assistant",
            "Natural language booking",
            "Smart reminders & notifications",
            "Priority support",
          ],
          pl: [
            "Do 5 mistrzów",
            "Wszystkie kanały: Telegram, Instagram, WhatsApp",
            "Asystent AI do rezerwacji",
            "Rezerwacja w języku naturalnym",
            "Inteligentne przypomnienia i powiadomienia",
            "Priorytetowe wsparcie",
          ],
        },
      },
      {
        id: "max",
        name: "MAX",
        price: 90,
        currency: "PLN",
        masters: -1, // unlimited
        popular: false,
        subtitle: {
          ru: "Для сети салонов или крупной команды",
          ua: "Для мережі салонів або великої команди",
          en: "For salon chains or large teams",
          pl: "Dla sieci salonów lub dużego zespołu",
        },
        featureList: {
          ru: [
            "Неограниченно мастеров",
            "Все функции Pro",
            "Кастомное имя и фото бота",
            "Управление несколькими локациями",
            "Персональная настройка и онбординг",
            "Выделенный менеджер поддержки",
          ],
          ua: [
            "Необмежено майстрів",
            "Усі функції Pro",
            "Кастомне ім'я та фото бота",
            "Керування кількома локаціями",
            "Персональне налаштування та онбординг",
            "Виділений менеджер підтримки",
          ],
          en: [
            "Unlimited specialists",
            "All Pro features",
            "Custom bot name & photo",
            "Multi-location management",
            "Personal setup & onboarding",
            "Dedicated support manager",
          ],
          pl: [
            "Nieograniczona liczba mistrzów",
            "Wszystkie funkcje Pro",
            "Niestandardowa nazwa i zdjęcie bota",
            "Zarządzanie wieloma lokalizacjami",
            "Personalna konfiguracja i onboarding",
            "Dedykowany menedżer wsparcia",
          ],
        },
      },
    ];
  }),

  createCheckoutSession: publicProcedure
    .input(z.object({ tenantId: z.string(), plan: z.enum(["start", "pro", "max"]) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      const priceMap: Record<string, string | undefined> = {
        start: env.STRIPE_PRICE_START_MONTHLY,
        pro: env.STRIPE_PRICE_PRO_MONTHLY,
        max: env.STRIPE_PRICE_MAX_MONTHLY,
      };
      const priceId = priceMap[input.plan];
      if (!priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Price not configured for plan: ${input.plan}` });
      }

      // Get tenant info for customer name
      const [tenant] = await ctx.db
        .select({ name: tenants.name, stripeCustomerId: tenants.stripeCustomerId, billingEmail: tenants.billingEmail })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });

      // Get or create Stripe customer
      let customerId = tenant.stripeCustomerId;
      if (!customerId) {
        customerId = await getOrCreateCustomer(stripeKey, {
          tenantId: input.tenantId,
          name: tenant.name,
          email: tenant.billingEmail ?? ctx.webUser?.email ?? undefined,
        });
        // Save customer ID to tenant
        await ctx.db
          .update(tenants)
          .set({ stripeCustomerId: customerId, updatedAt: Math.floor(Date.now() / 1000) })
          .where(eq(tenants.id, input.tenantId));
      }

      const baseUrl = typeof window !== "undefined" ? window.location.origin : (process.env.AUTH_URL ?? "https://admin.manicbot.com");
      const url = await createCheckoutSession(stripeKey, {
        customerId,
        priceId,
        successUrl: `${baseUrl}/settings?section=billing&checkout=success`,
        cancelUrl: `${baseUrl}/settings?section=billing`,
        tenantId: input.tenantId,
      });

      return { url };
    }),

  createBillingPortalSession: publicProcedure.input(tenantIdInput).mutation(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);

    const stripeKey = env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
    }

    const [tenant] = await ctx.db
      .select({ stripeCustomerId: tenants.stripeCustomerId })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);

    if (!tenant?.stripeCustomerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No active subscription. Subscribe first." });
    }

    const baseUrl = process.env.AUTH_URL ?? "https://admin.manicbot.com";
    const url = await createBillingPortalSession(stripeKey, {
      customerId: tenant.stripeCustomerId,
      returnUrl: `${baseUrl}/settings?section=billing`,
    });

    return { url };
  }),

  // ── Meta Channels (Instagram / WhatsApp) ───────────────────────

  /** List connected Meta channels for a tenant. */
  getChannels: publicProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const rows = await ctx.db
      .select({
        id: channelConfigs.id,
        channelType: channelConfigs.channelType,
        active: channelConfigs.active,
        config: channelConfigs.config,
        createdAt: channelConfigs.createdAt,
      })
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, input.tenantId));
    return rows;
  }),

  /** Connect Instagram via Worker /admin/ig-channel. Requires WORKER_PUBLIC_URL + ADMIN_KEY env vars. */
  connectInstagram: publicProcedure
    .input(z.object({
      tenantId: z.string(),
      token: z.string().min(10),
      pageId: z.string().min(1),
      igAccountId: z.string().optional(),
      instagramBusinessId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const workerUrl = env.WORKER_PUBLIC_URL;
      const adminKey = env.ADMIN_KEY;
      if (!workerUrl || !adminKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Server not configured for Instagram connection. Set WORKER_PUBLIC_URL and ADMIN_KEY." });
      }

      const res = await fetch(`${workerUrl}/admin/ig-channel?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: input.token,
          pageId: input.pageId,
          tenantId: input.tenantId,
          igAccountId: input.igAccountId,
          instagramBusinessId: input.instagramBusinessId,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const data = await res.json() as { ok?: boolean; error?: string; graphMe?: { id: string; name: string }; channelConfigId?: string };
      if (!res.ok || !data.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: data.error ?? "Failed to connect Instagram" });
      }

      return { ok: true as const, channelConfigId: data.channelConfigId, graphMe: data.graphMe };
    }),

  /** Disconnect a Meta channel (instagram or whatsapp) by deleting its config. */
  disconnectChannel: publicProcedure
    .input(z.object({ tenantId: z.string(), channelType: z.enum(["instagram", "whatsapp"]) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .delete(channelConfigs)
        .where(and(
          eq(channelConfigs.tenantId, input.tenantId),
          eq(channelConfigs.channelType, input.channelType),
        ));
      return { ok: true as const };
    }),
});
