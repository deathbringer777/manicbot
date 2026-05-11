import { z } from "zod";
import { createTRPCRouter, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  appointments, masters, services, users, tenants, tenantConfig, localTickets, tenantRoles, bots, channelConfigs, webUsers,
} from "~/server/db/schema";
import { hashPassword } from "~/server/auth/password";
import { telegramGetMe, telegramSetWebhook, telegramDeleteWebhook } from "~/server/lib/telegramApi";
import { getOrCreateCustomer, createCheckoutSession, createEmbeddedCheckoutSession, createBillingPortalSession } from "~/server/lib/stripe";
import { signUploadToken, type UploadKind } from "~/server/lib/uploadToken";
import { eq, and, desc, sql, ne, like, or, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { buildMetaChannelHints } from "~/lib/metaChannelHints";
import { sanitizeText } from "~/server/security/sanitize";
import { encryptBotTokenForWorker } from "~/server/security/tokenEncryption";
import { log } from "~/server/utils/logger";
import { writeAudit, ctxIp } from "~/server/security/audit";

const tenantIdInput = z.object({ tenantId: z.string() });

export const salonRouter = createTRPCRouter({
  getOverview: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    const [aptRows, masterRows, ticketRows, tenantRow, serviceRows] = await Promise.all([
      ctx.db.select().from(appointments)
        .where(and(eq(appointments.tenantId, input.tenantId), eq(appointments.date, today))),
      ctx.db.select().from(masters).where(eq(masters.tenantId, input.tenantId)),
      ctx.db.select().from(localTickets)
        .where(and(eq(localTickets.tenantId, input.tenantId), eq(localTickets.open, 1))),
      ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
      ctx.db.select().from(services).where(eq(services.tenantId, input.tenantId)),
    ]);

    const todayApts = aptRows.filter((a) => !a.cancelled);
    const t = tenantRow[0];
    return {
      todayAppointments: todayApts.length,
      activeMasters: masterRows.filter((m: any) => m.active === 1).length,
      openTickets: ticketRows.length,
      plan: t?.plan ?? "start",
      billingStatus: t?.billingStatus ?? "trialing",
      // ── Profile completeness signals (consumed by ProfileCompletenessCard).
      //    Booleans are deliberate so the UI can show specific nudges for
      //    missing fields without re-fetching the full salon profile.
      profileCompleteness: {
        hasName: !!t?.name,
        hasDescription: !!t?.description,
        hasCity: !!t?.city,
        hasLogo: !!t?.logo,
        hasCoverPhoto: !!t?.coverPhoto,
        publicActive: t?.publicActive === 1,
        servicesCount: serviceRows.filter((s: any) => s.active === 1).length,
        mastersCount: masterRows.filter((m: any) => m.active === 1).length,
      },
    };
  }),

  getAppointments: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      date: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db.select().from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          ...(input.date ? [eq(appointments.date, input.date)] : []),
          ...(input.dateFrom ? [gte(appointments.date, input.dateFrom)] : []),
          ...(input.dateTo ? [lte(appointments.date, input.dateTo)] : []),
          ...(input.status ? [eq(appointments.status, input.status)] : []),
        ))
        .orderBy(desc(appointments.ts))
        .limit(input.limit ?? 100);
      return rows;
    }),

  getMasters: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return ctx.db.select().from(masters).where(eq(masters.tenantId, input.tenantId));
  }),

  getServices: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return ctx.db.select().from(services)
      .where(eq(services.tenantId, input.tenantId))
      .orderBy(services.sortOrder);
  }),

  getClients: tenantOwnerProcedure
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

  /**
   * Set client date-of-birth (YYYY-MM-DD). Used by the birthday-promo cron
   * to auto-generate a BDAY-* promo code on the matching MM-DD each year.
   * Pass null/empty string to clear.
   */
  setClientDob: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number().int(),
      dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .update(users)
        .set({ dob: input.dob })
        .where(and(eq(users.tenantId, input.tenantId), eq(users.chatId, input.chatId)));
      return { ok: true };
    }),

  getSalonProfile: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const [tenantRow, configRows] = await Promise.all([
      ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
      ctx.db.select().from(tenantConfig).where(eq(tenantConfig.tenantId, input.tenantId)),
    ]);
    const cfg = Object.fromEntries(configRows.map((r: any) => [r.key, r.value]));
    let salon = {};
    try { salon = tenantRow[0]?.salon ? JSON.parse(tenantRow[0].salon) : {}; } catch { /* ignore malformed JSON */ }
    let brandPalette: Record<string, string> | null = null;
    try {
      brandPalette = tenantRow[0]?.brandPalette ? JSON.parse(tenantRow[0].brandPalette) : null;
    } catch { /* ignore malformed JSON */ }
    return {
      name: tenantRow[0]?.name ?? "",
      salon,
      config: cfg,
      slug: tenantRow[0]?.slug ?? null,
      description: tenantRow[0]?.description ?? null,
      city: tenantRow[0]?.city ?? null,
      lat: tenantRow[0]?.lat ?? null,
      lng: tenantRow[0]?.lng ?? null,
      mapsUrl: tenantRow[0]?.mapsUrl ?? null,
      publicActive: tenantRow[0]?.publicActive ?? 0,
      photos: tenantRow[0]?.photos ? (() => { try { return JSON.parse(tenantRow[0]!.photos!); } catch { return []; } })() : [],
      logo: tenantRow[0]?.logo ?? null,
      coverPhoto: tenantRow[0]?.coverPhoto ?? null,
      displayName: tenantRow[0]?.displayName ?? null,
      logoR2Key: tenantRow[0]?.logoR2Key ?? null,
      coverR2Key: tenantRow[0]?.coverR2Key ?? null,
      brandPalette,
    };
  }),

  getBillingStatus: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const row = await ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
    if (!row.length) throw new TRPCError({ code: "NOT_FOUND" });
    const t = row[0]!;

    // Real-time expiry bridge: cron runs every 15 min but user opens the page now.
    // If trial has already expired in the DB but cron hasn't flipped it yet, flip it here.
    const nowUnix = Math.floor(Date.now() / 1000);
    let billingStatus = t.billingStatus ?? "trialing";
    if (billingStatus === "trialing" && t.trialEndsAt && nowUnix > t.trialEndsAt) {
      billingStatus = "inactive";
      void ctx.db.update(tenants)
        .set({ billingStatus: "inactive", updatedAt: nowUnix })
        .where(eq(tenants.id, input.tenantId));
    }

    return {
      plan: t.plan,
      billingStatus,
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
  getMetaChannelHints: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return buildMetaChannelHints({
      workerPublicUrl: env.WORKER_PUBLIC_URL,
      waVerify: env.META_VERIFY_TOKEN_WA,
      igVerify: env.META_VERIFY_TOKEN_IG,
    });
  }),

  markNoShow: tenantOwnerProcedure
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
        cancelReason: input.comment ? sanitizeText(input.comment, 500) : null,
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      return { success: true };
    }),

  cancelAppointment: tenantOwnerProcedure
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
        cancelReason: input.comment ? sanitizeText(input.comment, 500) : null,
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      return { success: true };
    }),

  checkSlugAvailable: tenantOwnerProcedure
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

  updateService: tenantOwnerProcedure
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
      photos: z.string().optional(),
      promo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const { tenantId, svcId, ...updates } = input;
      if (updates.names !== undefined) updates.names = sanitizeText(updates.names, 500);
      if (updates.description !== undefined) updates.description = sanitizeText(updates.description, 2000);
      if (updates.promo !== undefined) updates.promo = sanitizeText(updates.promo, 500);
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

  createService: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      emoji: z.string().optional(),
      duration: z.number(),
      price: z.number(),
      names: z.string(),
      description: z.string().optional(),
      photos: z.string().optional(),
      promo: z.string().optional(),
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
        names: sanitizeText(input.names, 500),
        description: input.description ? sanitizeText(input.description, 2000) : null,
        photos: input.photos ?? null,
        promo: input.promo ? sanitizeText(input.promo, 500) : null,
        active: input.active,
        hidden: input.hidden,
        sortOrder: input.sortOrder,
      });
      return { svcId };
    }),

  deleteService: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), svcId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Soft-delete: mark as hidden + inactive rather than removing data
      await ctx.db.update(services).set({ active: 0, hidden: 1 }).where(
        and(eq(services.tenantId, input.tenantId), eq(services.svcId, input.svcId))
      );
      return { success: true };
    }),

  updateSalonProfile: tenantOwnerProcedure
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
      mapsUrl: z.string().max(2048).optional().or(z.literal("")),
      publicActive: z.number().min(0).max(1).optional(),
      photos: z.array(z.string()).optional(),
      logo: z.string().url().optional().or(z.literal("")),
      coverPhoto: z.string().url().optional().or(z.literal("")),
      // Branding v2
      displayName: z.string().min(1).max(120).optional().or(z.literal("")),
      logoR2Key: z.string().max(256).optional().or(z.literal("")),
      coverR2Key: z.string().max(256).optional().or(z.literal("")),
      brandPalette: z
        .object({
          primary: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
          bg: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
          text: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
        })
        .nullable()
        .optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // 1. Update tenants.salon JSON field and tenants.name
      const tenantRow = await ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
      if (!tenantRow.length) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });

      // Guard: going public requires a usable profile — slug + name + at least
      // one service. Prevents empty cards from appearing in the public catalog
      // and being unclickable (see publicSalon.search slug filter).
      if (input.publicActive === 1) {
        const nextSlug = input.slug !== undefined ? input.slug : tenantRow[0]!.slug;
        const nextName = input.name !== undefined ? input.name : tenantRow[0]!.name;
        const missing: string[] = [];
        if (!nextSlug) missing.push("slug");
        if (!nextName || !nextName.trim()) missing.push("name");
        const serviceCount = await ctx.db.select({ svcId: services.svcId })
          .from(services)
          .where(eq(services.tenantId, input.tenantId))
          .limit(1);
        if (serviceCount.length === 0) missing.push("services");
        if (missing.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `NOT_READY_TO_PUBLISH:${missing.join(",")}`,
          });
        }
      }

      let existing: Record<string, unknown> = {};
      try { existing = tenantRow[0]!.salon ? JSON.parse(tenantRow[0]!.salon!) : {}; } catch { /* ignore malformed JSON */ }
      if (input.address !== undefined) existing.address = sanitizeText(input.address, 300);
      if (input.phone !== undefined) existing.phone = sanitizeText(input.phone, 50);
      if (input.workHours !== undefined) existing.workHours = sanitizeText(input.workHours, 200);
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
      if (input.name !== undefined) tenantUpdate.name = sanitizeText(input.name, 200);
      if (input.slug !== undefined) tenantUpdate.slug = input.slug || null;
      if (input.description !== undefined) tenantUpdate.description = input.description ? sanitizeText(input.description, 1000) : null;
      if (input.city !== undefined) tenantUpdate.city = input.city ? sanitizeText(input.city, 100) : null;
      if (input.lat !== undefined) tenantUpdate.lat = input.lat;
      if (input.lng !== undefined) tenantUpdate.lng = input.lng;
      if (input.mapsUrl !== undefined) tenantUpdate.mapsUrl = input.mapsUrl || null;
      if (input.publicActive !== undefined) tenantUpdate.publicActive = input.publicActive;
      if (input.photos !== undefined) tenantUpdate.photos = JSON.stringify(input.photos);
      if (input.logo !== undefined) tenantUpdate.logo = input.logo || null;
      if (input.coverPhoto !== undefined) tenantUpdate.coverPhoto = input.coverPhoto || null;
      if (input.displayName !== undefined) tenantUpdate.displayName = input.displayName ? sanitizeText(input.displayName, 120) : null;
      if (input.logoR2Key !== undefined) tenantUpdate.logoR2Key = input.logoR2Key || null;
      if (input.coverR2Key !== undefined) tenantUpdate.coverR2Key = input.coverR2Key || null;
      if (input.brandPalette !== undefined) {
        tenantUpdate.brandPalette = input.brandPalette ? JSON.stringify(input.brandPalette) : null;
      }
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

  /**
   * Read per-channel auto-confirm settings for a tenant. Defaults: web=ON,
   * telegram/whatsapp/instagram=OFF. Stored in `tenant_config` under keys
   * `auto_confirm_{channel}` so no schema migration is needed.
   *
   * Source-of-truth defaults live in the Worker
   * (`manicbot/src/services/services.js:getAutoConfirm`); the values
   * returned here must match.
   */
  getAutoConfirmSettings: tenantOwnerProcedure
    .input(tenantIdInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db.select().from(tenantConfig)
        .where(eq(tenantConfig.tenantId, input.tenantId));
      const cfg = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
      const parse = (key: string, fallback: boolean): boolean => {
        const v = cfg[key];
        if (v == null) return fallback;
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
          const s = v.trim().toLowerCase();
          return s === "true" || s === "1";
        }
        return fallback;
      };
      return {
        web: parse("auto_confirm_web", true),
        telegram: parse("auto_confirm_telegram", false),
        whatsapp: parse("auto_confirm_whatsapp", false),
        instagram: parse("auto_confirm_instagram", false),
      };
    }),

  /**
   * Toggle auto-confirm for one channel. The client sends a single
   * (channel, enabled) pair so the UI can render four independent
   * switches that don't fight over a shared object. Stored as the
   * JSON literal `true` / `false` so the Worker's `getAutoConfirm`
   * helper can parse it back.
   */
  setAutoConfirm: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      channel: z.enum(["web", "telegram", "whatsapp", "instagram"]),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const key = `auto_confirm_${input.channel}`;
      const value = JSON.stringify(input.enabled);
      await ctx.db.insert(tenantConfig)
        .values({ tenantId: input.tenantId, key, value })
        .onConflictDoUpdate({ target: [tenantConfig.tenantId, tenantConfig.key], set: { value } });
      return { success: true };
    }),

  /**
   * Mint a short-lived HMAC-signed upload token for the Worker's /upload/asset
   * endpoint. The client uses this to upload a salon branding asset (logo,
   * cover photo, gallery photo, master portfolio) directly to R2 via the Worker.
   *
   * Requires: tenant owner for `tenantId`, UPLOAD_TOKEN_SECRET env var on Pages,
   * WORKER_PUBLIC_URL env var on Pages.
   */
  mintUploadToken: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      kind: z.enum(["logo", "cover", "photo", "portfolio", "service_photo"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!env.UPLOAD_TOKEN_SECRET) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "UPLOAD_TOKEN_SECRET not configured on admin-app",
        });
      }
      if (!env.WORKER_PUBLIC_URL) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "WORKER_PUBLIC_URL not configured on admin-app",
        });
      }
      const token = await signUploadToken({
        tid: input.tenantId,
        kind: input.kind as UploadKind,
        secret: env.UPLOAD_TOKEN_SECRET,
      });
      const base = env.WORKER_PUBLIC_URL.replace(/\/$/, "");
      return {
        token,
        uploadUrl: `${base}/upload/asset?t=${encodeURIComponent(token)}&kind=${encodeURIComponent(input.kind)}`,
      };
    }),

  updateAppointmentStatus: tenantOwnerProcedure
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
        if (input.cancelReason) setObj.cancelReason = sanitizeText(input.cancelReason, 500);
      }
      if (input.status === "rejected" && input.rejectComment) {
        setObj.rejectComment = sanitizeText(input.rejectComment, 500);
      }
      if (input.status === "confirmed") {
        setObj.confirmedBy = null;
      }

      // Defense-in-depth: include tenant_id in WHERE clause even though
      // assertTenantOwner + ownership SELECT above already enforce this.
      await ctx.db.update(appointments).set(setObj)
        .where(and(eq(appointments.id, input.appointmentId), eq(appointments.tenantId, input.tenantId)));

      // Fire-and-forget: notify Worker to send Telegram message + sync calendar
      const workerUrl = env.WORKER_PUBLIC_URL;
      const adminKey = env.ADMIN_KEY;
      if (workerUrl && adminKey) {
        // #S9: ADMIN_KEY moved from query string to Authorization: Bearer header.
        fetch(`${workerUrl}/admin/appointment-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
          body: JSON.stringify({ action: input.status, appointmentId: input.appointmentId, tenantId: input.tenantId, confirmedBy: setObj.confirmedBy ?? null }),
        }).catch(e => log.error("salon.workerNotify", e instanceof Error ? e : new Error(String(e))));
      }

      return { success: true };
    }),

  addMaster: tenantOwnerProcedure
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
        name: sanitizeText(input.name, 200),
      });
      // Also assign tenant_roles entry so master can access the mini-app
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(tenantRoles)
        .values({ tenantId: input.tenantId, chatId: input.chatId, role: "master", createdAt: now })
        .onConflictDoUpdate({ target: [tenantRoles.tenantId, tenantRoles.chatId], set: { role: "master", createdAt: now } });
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "role.master.add",
        tenantId: input.tenantId,
        detail: `chatId=${input.chatId}`,
        ip: ctxIp(ctx),
      });
      return { success: true };
    }),

  removeMaster: tenantOwnerProcedure
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
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "role.master.remove",
        tenantId: input.tenantId,
        detail: `chatId=${input.chatId}`,
        ip: ctxIp(ctx),
      });
      // Clean up web_users record for web-created masters (synthetic chatId >= 10B)
      // Match by reverse-engineering the UUID prefix or simply by tenantId + role + name
      if (input.chatId >= 10_000_000_000) {
        try {
          const webMasters = await ctx.db.select({ id: webUsers.id }).from(webUsers)
            .where(and(eq(webUsers.tenantId, input.tenantId), eq(webUsers.role, "master")));
          for (const wu of webMasters) {
            const synth = 10_000_000_000 + (parseInt(wu.id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);
            if (synth === input.chatId) {
              await ctx.db.delete(webUsers).where(eq(webUsers.id, wu.id));
              break;
            }
          }
        } catch { /* best-effort */ }
      }
      return { success: true };
    }),

  createMasterAccount: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      name: z.string().min(1).max(200),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Generate login
      const sanitized = input.name.toLowerCase().replace(/[^a-z0-9а-яёіїєґ]/gi, "").slice(0, 20) || "master";
      const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      const login = input.email?.trim().toLowerCase() ?? `${sanitized}.${suffix}@salon.manicbot.local`;

      // Check duplicate
      const existing = await ctx.db.select({ id: webUsers.id }).from(webUsers)
        .where(eq(webUsers.email, login)).limit(1);
      if (existing.length) {
        throw new TRPCError({ code: "CONFLICT", message: "Account with this email already exists" });
      }

      // Generate 16-char password
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      const pwArr = crypto.getRandomValues(new Uint8Array(16));
      const password = Array.from(pwArr).map(b => chars[b % chars.length]).join("");

      const passwordHash = await hashPassword(password);
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      // Synthetic chatId (same formula as webUsers.register)
      const syntheticChatId = 10_000_000_000 + (parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);

      const sanitizedName = sanitizeText(input.name, 200);
      // Insert web_users
      await ctx.db.insert(webUsers).values({
        id,
        email: login,
        passwordHash,
        role: "master",
        tenantId: input.tenantId,
        name: sanitizedName,
        emailVerified: input.email ? 0 : 1, // generated emails don't need verification
        createdAt: now,
        updatedAt: now,
      });

      // Insert masters — bind to the just-created webUser so that S-01/S-03
      // authorization works for invited multi-master tenants out of the box.
      // isSynthetic=1 because chatId is synthetic — 0052 migration adds
      // an explicit flag so cron post-visit + Telegram-dependent jobs
      // skip these rows.
      await ctx.db.insert(masters).values({
        tenantId: input.tenantId,
        chatId: syntheticChatId,
        name: sanitizedName,
        active: 1,
        addedAt: now,
        webUserId: id,
        isSynthetic: 1,
      });

      // Assign tenant_roles
      await ctx.db.insert(tenantRoles)
        .values({ tenantId: input.tenantId, chatId: syntheticChatId, role: "master", createdAt: now })
        .onConflictDoUpdate({ target: [tenantRoles.tenantId, tenantRoles.chatId], set: { role: "master", createdAt: now } });

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "tenant.master.create",
        tenantId: input.tenantId,
        detail: `masterId=${syntheticChatId} webUserId=${id}`,
        ip: ctxIp(ctx),
      });
      return { login, password, masterId: syntheticChatId, webUserId: id };
    }),

  // ── Bot Connection ─────────────────────────────────────────────

  getBotStatus: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
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

  connectBot: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), token: z.string().min(10).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // #H3 — fail closed if BOT_ENCRYPTION_KEY is unset. Without it the encrypted
      // token cannot be persisted, and the Worker would silently 401 every webhook.
      // Better to refuse onboarding than to leave a bricked bot row in D1.
      if (!env.BOT_ENCRYPTION_KEY || env.BOT_ENCRYPTION_KEY.length < 32) {
        log.error("salon.connectBot", new Error("BOT_ENCRYPTION_KEY not configured (≥32 chars required) — refusing to register bot without encryption"));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Bot registration is temporarily unavailable. Please contact support.",
        });
      }

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

      // Check bot not used by another tenant (cross-tenant by design — bot_id
      // is globally unique; we intentionally scan all tenants to detect collisions).
      const otherTenant = await ctx.db
        .select({ tenantId: bots.tenantId })
        .from(bots)
        .where(eq(bots.botId, botId))
        .limit(1);
      if (otherTenant.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "This bot is already connected to another salon." });
      }

      // Encrypt the token BEFORE making any external mutations. If encryption
      // fails (unexpected — guarded above), we don't want to register a webhook
      // pointing at a bot we can't service.
      const tokenEncrypted = await encryptBotTokenForWorker(input.token, env.BOT_ENCRYPTION_KEY);
      if (!tokenEncrypted) {
        log.error("salon.connectBot", new Error("encryptBotTokenForWorker returned null despite BOT_ENCRYPTION_KEY being present"));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Token encryption failed. Please contact support." });
      }

      // Set webhook
      const webhookUrl = `https://manicbot.com/webhook/${botId}`;
      try {
        await telegramSetWebhook(input.token, webhookUrl, webhookSecret);
      } catch (err: any) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to set webhook: ${err.message}` });
      }

      // Register bot in D1 with the encrypted token so the Worker can resolve
      // it via getBotToken on inbound webhook traffic.
      await ctx.db.insert(bots).values({
        botId,
        tenantId: input.tenantId,
        botUsername: botInfo.username ?? null,
        tokenEncrypted,
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

  disconnectBot: tenantOwnerProcedure.input(tenantIdInput).mutation(async ({ ctx, input }) => {
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

  getPlans: tenantOwnerProcedure.query(() => {
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

  createCheckoutSession: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      plan: z.enum(["start", "pro", "max"]),
      locale: z.string().optional(),
      billingCycle: z.enum(["monthly", "annual"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      const cycle = input.billingCycle ?? "monthly";
      const monthly: Record<string, string | undefined> = {
        start: env.STRIPE_PRICE_START_MONTHLY,
        pro: env.STRIPE_PRICE_PRO_MONTHLY,
        max: env.STRIPE_PRICE_MAX_MONTHLY,
      };
      const annual: Record<string, string | undefined> = {
        start: env.STRIPE_PRICE_START_ANNUAL,
        pro: env.STRIPE_PRICE_PRO_ANNUAL,
        max: env.STRIPE_PRICE_MAX_ANNUAL,
      };
      const priceId = (cycle === "annual" ? annual[input.plan] : monthly[input.plan])
        ?? monthly[input.plan]; // fallback to monthly if annual unset
      if (!priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Price not configured for plan: ${input.plan} (${cycle})` });
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
        plan: input.plan,
        locale: input.locale,
        billingCycle: cycle,
      });

      return { url };
    }),

  createEmbeddedCheckout: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      plan: z.enum(["start", "pro", "max"]),
      locale: z.string().optional(),
      billingCycle: z.enum(["monthly", "annual"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      const cycle = input.billingCycle ?? "monthly";
      const monthly: Record<string, string | undefined> = {
        start: env.STRIPE_PRICE_START_MONTHLY,
        pro: env.STRIPE_PRICE_PRO_MONTHLY,
        max: env.STRIPE_PRICE_MAX_MONTHLY,
      };
      const annual: Record<string, string | undefined> = {
        start: env.STRIPE_PRICE_START_ANNUAL,
        pro: env.STRIPE_PRICE_PRO_ANNUAL,
        max: env.STRIPE_PRICE_MAX_ANNUAL,
      };
      const priceId = (cycle === "annual" ? annual[input.plan] : monthly[input.plan])
        ?? monthly[input.plan];
      if (!priceId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Price not configured for plan: ${input.plan} (${cycle})` });
      }

      const [tenant] = await ctx.db
        .select({ name: tenants.name, stripeCustomerId: tenants.stripeCustomerId, billingEmail: tenants.billingEmail })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });

      let customerId = tenant.stripeCustomerId;
      if (!customerId) {
        customerId = await getOrCreateCustomer(stripeKey, {
          tenantId: input.tenantId,
          name: tenant.name,
          email: tenant.billingEmail ?? ctx.webUser?.email ?? undefined,
        });
        await ctx.db
          .update(tenants)
          .set({ stripeCustomerId: customerId, updatedAt: Math.floor(Date.now() / 1000) })
          .where(eq(tenants.id, input.tenantId));
      }

      const baseUrl = process.env.AUTH_URL ?? "https://admin.manicbot.com";
      const returnUrl = `${baseUrl}/settings?section=billing&checkout=success`;

      const clientSecret = await createEmbeddedCheckoutSession(stripeKey, {
        customerId,
        priceId,
        returnUrl,
        tenantId: input.tenantId,
        plan: input.plan,
        locale: input.locale,
        billingCycle: cycle,
      });

      return { clientSecret };
    }),

  createBillingPortalSession: tenantOwnerProcedure.input(tenantIdInput).mutation(async ({ ctx, input }) => {
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
  getChannels: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
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
  connectInstagram: tenantOwnerProcedure
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

      // #S9: ADMIN_KEY moved from query string to Authorization: Bearer header.
      const res = await fetch(`${workerUrl}/admin/ig-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
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
  disconnectChannel: tenantOwnerProcedure
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
