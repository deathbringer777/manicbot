import { z } from "zod";
import { createTRPCRouter, tenantOwnerProcedure, protectedProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import {
  appointments, masters, services, users, tenants, tenantConfig, localTickets, tenantRoles, bots, channelConfigs, webUsers, messageWindows, errorEvents, tenantMemberPermissions,
  masterInvitations, masterPairingCodes, serviceCategories, photoAlbums, albumPhotos, tenantActionRequests, auditLog,
} from "~/server/db/schema";
import { PERMISSION_TEMPLATES, MASTER_DEFAULT, type PermissionKey } from "~/server/api/permissions";
import { hashPassword } from "~/server/auth/password";
import { telegramGetMe, telegramSetWebhook, telegramDeleteWebhook } from "~/server/lib/telegramApi";
import { getOrCreateCustomer, createCheckoutSession, createEmbeddedCheckoutSession, createBillingPortalSession, createOneTimePercentOffCoupon } from "~/server/lib/stripe";
import { referrals } from "~/server/db/schema";
import { signUploadToken, type UploadKind } from "~/server/lib/uploadToken";
import { isHttpsUrl } from "~/server/lib/url";
import { eq, and, desc, sql, ne, like, or, gte, lte, isNull, gt, inArray, getTableColumns } from "drizzle-orm";
import { appointmentNameColumns, foldAppointmentNames } from "~/server/api/appointmentNames";
import {
  generatePairingToken,
  buildDeepLink,
  PAIRING_TOKEN_TTL_SEC,
} from "~/server/api/masterPairing/tokenLogic";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { buildMetaChannelHints } from "~/lib/metaChannelHints";
import {
  parseMasterHours,
  isValidMasterHours,
  serializeMasterHours,
  parseMasterWorkDays,
  serializeMasterWorkDays,
  decodeMasterSchedule,
  validateMasterSchedule,
  serializeMasterSchedule,
  deriveWorkDaysFromSchedule,
} from "~/lib/workHours";
import { MASTER_SCHEDULE_POLICIES } from "~/lib/masterSchedulePolicy";
import { getTenantMetrics } from "~/server/metrics/tenant";
import { t } from "~/lib/i18n";
import { sanitizeText } from "~/server/security/sanitize";
import { encryptBotTokenForWorker } from "~/server/security/tokenEncryption";
import { encryptMasterPassword, decryptMasterPassword } from "~/server/security/masterPasswordVault";
import { log } from "~/server/utils/logger";
import { notifyWorker } from "~/server/utils/notifyWorker";
import { parseServicesCsv, servicesToCsv } from "~/server/services/servicesCsv";
import { writeAudit, ctxIp } from "~/server/security/audit";
import { addMasterToDefaultGroup } from "~/server/messenger/defaultStaffGroup";
import { notifyWebUser } from "~/server/services/notifyWebUser";
import { notifyOrCapture } from "~/server/services/notifyOrCapture";
import { captureError } from "~/server/utils/captureError";
import {
  IG_ALL_ERROR_TYPES,
  IG_BROKEN_ERROR_TYPES,
} from "~/server/api/channelErrorTypes";
import {
  sendMasterInviteEmail,
  sendMasterInviteExistingUserEmail,
  sendMasterInviteNewUserEmail,
  sendMasterPasswordResetCredentialsToOwnerEmail,
} from "~/server/email/emailService";
import { generateToken, hashToken } from "~/server/auth/tokens";
import { requireOtpConfirmation } from "~/server/auth/otp";
import { checkRateLimit } from "~/server/auth/rateLimit";
import type { Lang } from "~/lib/i18n";

const tenantIdInput = z.object({ tenantId: z.string() });

/**
 * Referral attach helper (PR-B).
 *
 * If the caller has a `referrals` row in status='pending' (= they were
 * invited via a code and have not yet paid an invoice), mint a one-shot
 * Stripe coupon for the discount and return `{ couponId, referralId }` so
 * the checkout session can pass them through.
 *
 * Returns `null` when there is no pending referral, when Stripe is not
 * configured, OR when the coupon mint fails — in all cases the checkout
 * proceeds at full price. A referral row is never marked applied here;
 * that only happens inside the Worker invoice.paid handler, so a failed
 * Stripe coupon mint doesn't burn the referral.
 */
async function maybeAttachReferral(
  ctx: { db: ReturnType<typeof import("~/server/db").getDb>; webUser: { id: string } | null | undefined },
  billingCycle: "monthly" | "annual",
): Promise<{ couponId: string; referralId: string } | null> {
  if (!ctx.webUser) return null;
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) return null;

  const [row] = await ctx.db
    .select({
      id: referrals.id,
      status: referrals.status,
    })
    .from(referrals)
    .where(and(
      eq(referrals.inviteeWebUserId, ctx.webUser.id),
      eq(referrals.status, "pending"),
    ))
    .limit(1);
  if (!row) return null;

  const percentOff = billingCycle === "annual" ? 10 : 20;
  const discountKind = billingCycle === "annual" ? "10pct_yearly" : "20pct_monthly";

  let couponId: string;
  try {
    couponId = await createOneTimePercentOffCoupon(stripeKey, {
      percentOff,
      name: `Referral — ${discountKind}`,
      metadata: { referralId: row.id, kind: discountKind },
    });
  } catch (err) {
    log.error("salon.maybeAttachReferral: coupon mint failed", err instanceof Error ? err : new Error(String(err)));
    return null;
  }

  // Stamp the kind on the referral so the dashboard can show the right
  // discount label. invoice_discount_applied_at is set on webhook fire.
  await ctx.db
    .update(referrals)
    .set({ inviteeDiscountKind: discountKind, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(referrals.id, row.id));

  return { couponId, referralId: row.id };
}

export const salonRouter = createTRPCRouter({
  /**
   * Per-salon operational metrics (clients processed, appointments) — the
   * tenant-facing half of the metrics split. Uses the SAME getTenantMetrics
   * the God-Mode per-tenant view does, so the owner sees identical numbers.
   * Tenant-isolated via assertTenantOwner.
   */
  getMyMetrics: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    return getTenantMetrics(ctx.db, input.tenantId, Math.floor(Date.now() / 1000));
  }),

  getOverview: tenantOwnerProcedure.input(tenantIdInput).query(async ({ ctx, input }) => {
    await assertTenantOwner(ctx, input.tenantId);
    const today = new Date().toISOString().slice(0, 10);

    // Today's appointment count via aggregate (relax.md §4 P1) — the
    // previous `select().from(appointments)` pulled every column (incl.
    // `notes`, `user_phone`, `user_tg`) just to compute `.length`. With
    // the dashboard refreshing on visibility-change, this could move
    // tens of KB per call on busy salons.
    const [aptCountRow, masterRows, ticketCountRow, tenantRow, serviceRows] = await Promise.all([
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.date, today),
          eq(appointments.cancelled, 0),
        )),
      ctx.db.select().from(masters).where(eq(masters.tenantId, input.tenantId)),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(localTickets)
        .where(and(eq(localTickets.tenantId, input.tenantId), eq(localTickets.open, 1))),
      ctx.db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1),
      ctx.db.select().from(services).where(eq(services.tenantId, input.tenantId)),
    ]);

    const t = tenantRow[0];
    return {
      todayAppointments: Number(aptCountRow[0]?.count ?? 0),
      activeMasters: masterRows.filter((m: any) => m.active === 1).length,
      openTickets: Number(ticketCountRow[0]?.count ?? 0),
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
      // Resolve client + service names at read time (see appointmentNames.ts).
      const rows = await ctx.db
        .select({ ...getTableColumns(appointments), ...appointmentNameColumns })
        .from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          ...(input.date ? [eq(appointments.date, input.date)] : []),
          ...(input.dateFrom ? [gte(appointments.date, input.dateFrom)] : []),
          ...(input.dateTo ? [lte(appointments.date, input.dateTo)] : []),
          ...(input.status ? [eq(appointments.status, input.status)] : []),
        ))
        .orderBy(desc(appointments.ts))
        .limit(input.limit ?? 100);
      return rows.map(foldAppointmentNames);
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
      chatEnabled: tenantRow[0]?.chatEnabled ?? 1,
      photos: tenantRow[0]?.photos ? (() => { try { return JSON.parse(tenantRow[0]!.photos!); } catch { return []; } })() : [],
      logo: tenantRow[0]?.logo ?? null,
      coverPhoto: tenantRow[0]?.coverPhoto ?? null,
      displayName: tenantRow[0]?.displayName ?? null,
      logoR2Key: tenantRow[0]?.logoR2Key ?? null,
      coverR2Key: tenantRow[0]?.coverR2Key ?? null,
      bgImage: tenantRow[0]?.bgImage ?? null,
      bgR2Key: tenantRow[0]?.bgR2Key ?? null,
      brandPalette,
      instagramUrl: tenantRow[0]?.instagramUrl ?? null,
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
      const action = input.noShowBy === "client" ? "no_show_client" : "no_show_master";
      notifyWorker(action, input.id, input.tenantId, null).catch(() => {});
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
      notifyWorker("cancel", input.id, input.tenantId, null).catch(() => {});
      return { success: true };
    }),

  /**
   * pending → confirmed. Mirrors `appointments.updateStatus` (God Mode)
   * but tenant-scoped. Fires Worker action=confirm so the client gets
   * the existing "ваша запись подтверждена" message and Google Calendar
   * syncs the event.
   */
  confirmAppointment: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const [row] = await ctx.db
        .select({ status: appointments.status, cancelled: appointments.cancelled })
        .from(appointments)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
      }
      if (row.cancelled || (row.status !== "pending" && row.status !== "confirmed")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_status_transition" });
      }
      await ctx.db
        .update(appointments)
        .set({ status: "confirmed" })
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      notifyWorker("confirm", input.id, input.tenantId, null).catch(() => {});
      return { success: true };
    }),

  /**
   * pending → rejected. Fires Worker action=reject so the client receives
   * the "запись отклонена, перебронируйте" prompt with a rebook button.
   */
  rejectAppointment: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      comment: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const [row] = await ctx.db
        .select({ status: appointments.status, cancelled: appointments.cancelled })
        .from(appointments)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
      }
      if (row.cancelled || row.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_status_transition" });
      }
      await ctx.db.update(appointments).set({
        status: "rejected",
        rejectComment: input.comment ? sanitizeText(input.comment, 500) : "",
      }).where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      notifyWorker("reject", input.id, input.tenantId, null).catch(() => {});
      return { success: true };
    }),

  /**
   * confirmed → done. Refuses if `apt.ts` is still in the future (per
   * product decision: cannot mark an appointment complete before its
   * start). The Worker fans out the default thank-you / review-request
   * via the marketing-automations dispatcher; if no automation row is
   * enabled the Worker falls back to a built-in default. Side-effects
   * (lifetime_visits++, last_visit_at, reminder cleanup) live in the
   * Worker so they apply uniformly to all callers.
   */
  markDone: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const [row] = await ctx.db
        .select({
          status: appointments.status,
          cancelled: appointments.cancelled,
          ts: appointments.ts,
        })
        .from(appointments)
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "appointment_not_found" });
      }
      if (row.cancelled || (row.status !== "confirmed" && row.status !== "pending")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_status_transition" });
      }
      // appointments.ts is epoch MILLISECONDS (Warsaw→UTC); compare against
      // Date.now() in ms. BUG-02: comparing against seconds rejected every real
      // (ms) past bot booking, so owners could never mark them Done.
      if (row.ts > Date.now()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot_mark_done_before_start" });
      }
      await ctx.db
        .update(appointments)
        .set({ status: "done" })
        .where(and(eq(appointments.id, input.id), eq(appointments.tenantId, input.tenantId)));
      notifyWorker("done", input.id, input.tenantId, null).catch(() => {});
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
      category: z.string().max(100).optional().nullable(),
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
      category: z.string().max(100).optional().nullable(),
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
        category: input.category ?? null,
      });
      return { svcId };
    }),

  /**
   * Smart delete. Appointment rows resolve their service NAME live from
   * `services` at read time (see appointmentNames.ts), so hard-deleting a
   * service that has bookings would degrade its history to a raw `svc_…` id.
   * We therefore hard-delete ONLY when nothing references the service;
   * otherwise we hide it (active=0, hidden=1) to preserve that history.
   * Either way the dashboard list drops it — SalonDashboard filters out
   * `hidden=1` rows — so the service disappears immediately from the operator's
   * view. `hardDeleted` reports which path ran.
   */
  deleteService: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), svcId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const where = and(
        eq(services.tenantId, input.tenantId),
        eq(services.svcId, input.svcId),
      );
      const refRows = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(appointments)
        .where(and(
          eq(appointments.tenantId, input.tenantId),
          eq(appointments.svcId, input.svcId),
        ));
      const hardDeleted = Number(refRows[0]?.count ?? 0) === 0;
      if (hardDeleted) {
        await ctx.db.delete(services).where(where);
      } else {
        await ctx.db.update(services).set({ active: 0, hidden: 1 }).where(where);
      }
      return { success: true, hardDeleted };
    }),

  // ── Service categories ──────────────────────────────────────────────────

  listServiceCategories: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({ category: services.category })
        .from(services)
        .where(and(
          eq(services.tenantId, input.tenantId),
          sql`category IS NOT NULL AND category != ''`,
        ))
        .groupBy(services.category)
        .orderBy(services.category);
      return rows.map(r => r.category).filter((c): c is string => Boolean(c));
    }),

  // Structured list with metadata + per-category usage count. Powers the
  // Service Categories management modal and the ServiceModal's category
  // dropdown. `usageCount` is the number of services currently assigned to
  // each category — drives the delete-confirm copy ("Эту категорию
  // используют 3 услуги. Перенести в …").
  serviceCategoriesList: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const cats = await ctx.db
        .select()
        .from(serviceCategories)
        .where(eq(serviceCategories.tenantId, input.tenantId))
        .orderBy(serviceCategories.sortOrder, serviceCategories.name);
      const counts = await ctx.db
        .select({ category: services.category, n: sql<number>`COUNT(*)` })
        .from(services)
        .where(and(
          eq(services.tenantId, input.tenantId),
          sql`category IS NOT NULL AND category != ''`,
        ))
        .groupBy(services.category);
      const countByName = new Map(counts.map(c => [c.category as string, Number(c.n)]));
      return cats.map(c => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        usageCount: countByName.get(c.name) ?? 0,
      }));
    }),

  createServiceCategory: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      name: z.string().trim().min(1, "Имя не может быть пустым").max(60, "Максимум 60 символов"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const name = input.name.trim();

      // Duplicate-name guard (also enforced by the UNIQUE index — this is
      // the friendly 4xx).
      const existing = await ctx.db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.tenantId, input.tenantId), eq(serviceCategories.name, name)))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Категория с таким именем уже существует" });
      }

      // Append at end of sort order.
      const maxRow = await ctx.db
        .select({ max: sql<number>`COALESCE(MAX(sort_order), -1)` })
        .from(serviceCategories)
        .where(eq(serviceCategories.tenantId, input.tenantId));
      const nextOrder = (Number(maxRow[0]?.max ?? -1)) + 1;

      const id = `sc_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await ctx.db.insert(serviceCategories).values({
        tenantId: input.tenantId,
        id,
        name,
        sortOrder: nextOrder,
        createdAt: Math.floor(Date.now() / 1000),
      });
      return { id, name, sortOrder: nextOrder };
    }),

  renameServiceCategory: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      newName: z.string().trim().min(1).max(60),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const newName = input.newName.trim();

      const row = await ctx.db
        .select({ name: serviceCategories.name })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.tenantId, input.tenantId), eq(serviceCategories.id, input.id)))
        .limit(1);
      if (row.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Категория не найдена" });
      }
      const oldName = row[0]!.name;
      if (oldName === newName) return { ok: true, changed: false };

      // Duplicate-name guard against the renamed-into name.
      const collision = await ctx.db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(
          eq(serviceCategories.tenantId, input.tenantId),
          eq(serviceCategories.name, newName),
          ne(serviceCategories.id, input.id),
        ))
        .limit(1);
      if (collision.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Категория с таким именем уже существует" });
      }

      // Rename in BOTH places. Order: services first → category last, so a
      // mid-flight failure leaves services pointing at the new name and the
      // catalog row still has the old name. The reverse order would leave
      // services pointing at a name no longer in the catalog (orphan).
      await ctx.db.update(services).set({ category: newName }).where(and(
        eq(services.tenantId, input.tenantId),
        eq(services.category, oldName),
      ));
      await ctx.db.update(serviceCategories).set({ name: newName }).where(and(
        eq(serviceCategories.tenantId, input.tenantId),
        eq(serviceCategories.id, input.id),
      ));
      return { ok: true, changed: true };
    }),

  deleteServiceCategory: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      reassignToId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const row = await ctx.db
        .select({ name: serviceCategories.name })
        .from(serviceCategories)
        .where(and(eq(serviceCategories.tenantId, input.tenantId), eq(serviceCategories.id, input.id)))
        .limit(1);
      if (row.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Категория не найдена" });
      }
      const oldName = row[0]!.name;

      // Resolve reassign target (must belong to the same tenant; can't
      // reassign to the category we're about to delete).
      let newName: string | null = null;
      if (input.reassignToId) {
        if (input.reassignToId === input.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Нельзя перенести услуги в удаляемую категорию" });
        }
        const target = await ctx.db
          .select({ name: serviceCategories.name })
          .from(serviceCategories)
          .where(and(eq(serviceCategories.tenantId, input.tenantId), eq(serviceCategories.id, input.reassignToId)))
          .limit(1);
        if (target.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Целевая категория не найдена" });
        }
        newName = target[0]!.name;
      }

      // Update services first (reassign or null), then delete the row.
      await ctx.db.update(services).set({ category: newName }).where(and(
        eq(services.tenantId, input.tenantId),
        eq(services.category, oldName),
      ));
      await ctx.db.delete(serviceCategories).where(and(
        eq(serviceCategories.tenantId, input.tenantId),
        eq(serviceCategories.id, input.id),
      ));
      return { ok: true, reassignedTo: newName };
    }),

  reorderServiceCategories: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      ids: z.array(z.string()).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Verify every id belongs to the tenant before writing — defends
      // against an attacker shuffling another tenant's order via a forged id.
      const known = await ctx.db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(and(
          eq(serviceCategories.tenantId, input.tenantId),
          inArray(serviceCategories.id, input.ids),
        ));
      const knownSet = new Set(known.map(k => k.id));
      const unknown = input.ids.filter(id => !knownSet.has(id));
      if (unknown.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Категории не найдены: ${unknown.join(", ")}`,
        });
      }
      // Renumber. Sequential awaits — D1 hot path, ~200ms for 20 categories.
      for (let i = 0; i < input.ids.length; i++) {
        await ctx.db.update(serviceCategories).set({ sortOrder: i }).where(and(
          eq(serviceCategories.tenantId, input.tenantId),
          eq(serviceCategories.id, input.ids[i]!),
        ));
      }
      return { ok: true, count: input.ids.length };
    }),

  // ── Photo albums (public gallery folders) ───────────────────────────────
  // Albums group public-gallery photos (e.g. by service type). The flat
  // tenants.photos array stays as the implicit "All / Все" default album, so
  // a salon that never creates an album is unaffected. Mirrors the
  // serviceCategories CRUD shape; every read/write is scoped by tenant_id.

  listAlbums: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const [albumRows, photoRows] = await Promise.all([
        ctx.db
          .select()
          .from(photoAlbums)
          .where(eq(photoAlbums.tenantId, input.tenantId))
          .orderBy(photoAlbums.sortOrder, photoAlbums.name),
        ctx.db
          .select()
          .from(albumPhotos)
          .where(eq(albumPhotos.tenantId, input.tenantId))
          .orderBy(albumPhotos.albumId, albumPhotos.sortOrder),
      ]);
      const byAlbum = new Map<string, { url: string; r2Key: string | null; caption: string | null }[]>();
      for (const p of photoRows) {
        const list = byAlbum.get(p.albumId) ?? [];
        list.push({ url: p.photoUrl, r2Key: p.photoR2Key ?? null, caption: p.caption ?? null });
        byAlbum.set(p.albumId, list);
      }
      return albumRows.map(a => ({
        id: a.id,
        name: a.name,
        coverUrl: a.coverUrl ?? null,
        sortOrder: a.sortOrder,
        photos: byAlbum.get(a.id) ?? [],
      }));
    }),

  createAlbum: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      name: z.string().trim().min(1, "Имя не может быть пустым").max(60, "Максимум 60 символов"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const name = sanitizeText(input.name.trim(), 60);
      // Append at end of sort order (mirror createServiceCategory).
      const maxRow = await ctx.db
        .select({ max: sql<number>`COALESCE(MAX(sort_order), -1)` })
        .from(photoAlbums)
        .where(eq(photoAlbums.tenantId, input.tenantId));
      const nextOrder = (Number(maxRow[0]?.max ?? -1)) + 1;
      const id = `al_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await ctx.db.insert(photoAlbums).values({
        tenantId: input.tenantId,
        id,
        name,
        coverUrl: null,
        sortOrder: nextOrder,
        createdAt: Math.floor(Date.now() / 1000),
      });
      return { id, name, sortOrder: nextOrder };
    }),

  renameAlbum: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      id: z.string(),
      newName: z.string().trim().min(1).max(60),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const row = await ctx.db
        .select({ id: photoAlbums.id })
        .from(photoAlbums)
        .where(and(eq(photoAlbums.tenantId, input.tenantId), eq(photoAlbums.id, input.id)))
        .limit(1);
      if (row.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Альбом не найден" });
      await ctx.db.update(photoAlbums)
        .set({ name: sanitizeText(input.newName.trim(), 60) })
        .where(and(eq(photoAlbums.tenantId, input.tenantId), eq(photoAlbums.id, input.id)));
      return { ok: true };
    }),

  deleteAlbum: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Photos first, then the album row — both tenant-scoped. R2 objects are
      // left in place (content-addressed, harmless), matching the existing
      // gallery/cover delete behaviour.
      await ctx.db.delete(albumPhotos).where(and(
        eq(albumPhotos.tenantId, input.tenantId),
        eq(albumPhotos.albumId, input.id),
      ));
      await ctx.db.delete(photoAlbums).where(and(
        eq(photoAlbums.tenantId, input.tenantId),
        eq(photoAlbums.id, input.id),
      ));
      return { ok: true };
    }),

  reorderAlbums: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      ids: z.array(z.string()).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      // Verify every id belongs to the tenant before writing — defends against
      // a forged id shuffling another tenant's album order.
      const known = await ctx.db
        .select({ id: photoAlbums.id })
        .from(photoAlbums)
        .where(and(eq(photoAlbums.tenantId, input.tenantId), inArray(photoAlbums.id, input.ids)));
      const knownSet = new Set(known.map(k => k.id));
      const unknown = input.ids.filter(id => !knownSet.has(id));
      if (unknown.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Альбомы не найдены: ${unknown.join(", ")}` });
      }
      for (let i = 0; i < input.ids.length; i++) {
        await ctx.db.update(photoAlbums).set({ sortOrder: i }).where(and(
          eq(photoAlbums.tenantId, input.tenantId),
          eq(photoAlbums.id, input.ids[i]!),
        ));
      }
      return { ok: true, count: input.ids.length };
    }),

  // Bulk-replace an album's photos (the per-album uploader calls this on save).
  // https-only URL guard per photo — these render into <img src>; same XSS
  // trust boundary as logo/coverPhoto in updateSalonProfile.
  setAlbumPhotos: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      albumId: z.string(),
      photos: z.array(z.object({
        url: z.string().regex(/^https:\/\//i, "URL must start with https://").max(2048),
        r2Key: z.string().max(256).optional(),
        caption: z.string().max(300).optional(),
      })).max(60),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const album = await ctx.db
        .select({ id: photoAlbums.id })
        .from(photoAlbums)
        .where(and(eq(photoAlbums.tenantId, input.tenantId), eq(photoAlbums.id, input.albumId)))
        .limit(1);
      if (album.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Альбом не найден" });

      // Full replace: drop existing rows, re-insert in order.
      await ctx.db.delete(albumPhotos).where(and(
        eq(albumPhotos.tenantId, input.tenantId),
        eq(albumPhotos.albumId, input.albumId),
      ));
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < input.photos.length; i++) {
        const p = input.photos[i]!;
        await ctx.db.insert(albumPhotos).values({
          tenantId: input.tenantId,
          albumId: input.albumId,
          id: `ap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
          photoUrl: p.url,
          photoR2Key: p.r2Key ?? null,
          caption: p.caption ? sanitizeText(p.caption, 300) : null,
          sortOrder: i,
          createdAt: now,
        });
      }
      // Keep the album cover in sync with the first photo (used by the public
      // album tabs as the folder thumbnail).
      await ctx.db.update(photoAlbums)
        .set({ coverUrl: input.photos[0]?.url ?? null })
        .where(and(eq(photoAlbums.tenantId, input.tenantId), eq(photoAlbums.id, input.albumId)));
      return { ok: true, count: input.photos.length };
    }),

  // ── CSV export/import ───────────────────────────────────────────────────

  exportServices: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(services)
        .where(eq(services.tenantId, input.tenantId))
        .orderBy(services.sortOrder);
      return { csv: servicesToCsv(rows as any[]) };
    }),

  importServices: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      csv: z.string().max(200_000),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const { rows, errors } = parseServicesCsv(input.csv);

      if (rows.length === 0 && errors.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Все строки содержат ошибки — ни одна услуга не импортирована" });
      }

      // Load existing services for this tenant to match by svc_id
      const existing = await ctx.db
        .select({ svcId: services.svcId })
        .from(services)
        .where(eq(services.tenantId, input.tenantId));
      const existingIds = new Set(existing.map(e => e.svcId));

      let created = 0;
      let updated = 0;

      for (const row of rows) {
        const names = JSON.stringify({ ru: row.name, en: row.name, ua: row.name, pl: row.name });
        const price = row.price ?? 0;
        const duration = row.duration ?? 60;
        const active = row.active ? 1 : 0;

        if (row.svcId && existingIds.has(row.svcId)) {
          // Update existing
          await ctx.db.update(services).set({
            names: sanitizeText(names, 500),
            price,
            duration,
            emoji: row.emoji ?? null,
            category: row.category ?? null,
            description: row.description ? sanitizeText(row.description, 2000) : null,
            active,
          }).where(and(
            eq(services.tenantId, input.tenantId),
            eq(services.svcId, row.svcId),
          ));
          updated++;
        } else {
          // Create new
          const svcId = `svc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await ctx.db.insert(services).values({
            tenantId: input.tenantId,
            svcId,
            names: sanitizeText(names, 500),
            price,
            duration,
            emoji: row.emoji ?? null,
            category: row.category ?? null,
            description: row.description ? sanitizeText(row.description, 2000) : null,
            active,
            hidden: 0,
            sortOrder: 0,
          });
          created++;
        }
      }

      return { created, updated, skippedErrors: errors.length, errors };
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
      // Salon-level policy: who may change a master's working hours.
      masterSchedulePolicy: z.enum(MASTER_SCHEDULE_POLICIES).optional(),
      // Public profile fields
      slug: z.string().regex(/^[a-z0-9-]+$/, "Только строчные латинские буквы, цифры и дефис").optional(),
      description: z.string().max(1000).optional(),
      city: z.string().max(100).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      mapsUrl: z.string().max(2048).optional().or(z.literal("")),
      publicActive: z.number().min(0).max(1).optional(),
      // 0091 — chat surface independent of catalog publication. Owners
      // toggle this on to expose `/salon/{slug}/chat` without putting
      // the salon card in the public directory. The Worker
      // `/chat/init` and `publicSalon.getProfileForChat` both gate on
      // this column (not `publicActive`). Default for new tenants is 1.
      chatEnabled: z.number().min(0).max(1).optional(),
      // U1/U2: every gallery entry must be https-only. `z.string()` alone (or
      // `.url()`) accepts `javascript:` / `data:` / `vbscript:`, which are
      // JSON-stringified verbatim into tenants.photos and reflected by every
      // publicSalon read into the public gallery `<img src>`. Reuses the shared
      // `isHttpsUrl` refinement (same guard the support router applies).
      photos: z
        .array(z.string().max(2048).refine(isHttpsUrl, { message: "URL must start with https://" }))
        .optional(),
      // Restrict to https-only URLs — `z.string().url()` alone permits
      // `javascript:` / `data:` schemes (WHATWG URL parses them). These fields
      // flow into og:image, JSON-LD and `<img src>`; even where the browser
      // currently de-fangs them, future renders into `<a href>` would turn
      // the gap into stored XSS. See salon-update-profile-security.test.ts.
      logo: z.string().regex(/^https:\/\//i, "URL must start with https://").max(2048).optional().or(z.literal("")),
      coverPhoto: z.string().regex(/^https:\/\//i, "URL must start with https://").max(2048).optional().or(z.literal("")),
      // Branding v2
      displayName: z.string().min(1).max(120).optional().or(z.literal("")),
      logoR2Key: z.string().max(256).optional().or(z.literal("")),
      coverR2Key: z.string().max(256).optional().or(z.literal("")),
      // Static page background (distinct from cover). Same https-only XSS
      // guard as logo/coverPhoto — flows into <img src> / inline style.
      bgImage: z.string().regex(/^https:\/\//i, "URL must start with https://").max(2048).optional().or(z.literal("")),
      bgR2Key: z.string().max(256).optional().or(z.literal("")),
      brandPalette: z
        .object({
          primary: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
          bg: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
          text: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
        })
        .nullable()
        .optional(),
      // SECURITY: must be a real instagram.com https URL — otherwise a malicious
      // tenant_owner can store `javascript:fetch(...)` and turn the public
      // salon page's <a href={instagramUrl}> link into stored XSS for every
      // visitor. See salon-update-profile-security.test.ts.
      instagramUrl: z
        .string()
        .regex(
          /^https:\/\/(www\.)?instagram\.com\//i,
          "Instagram URL must start with https://instagram.com/ or https://www.instagram.com/",
        )
        .max(300)
        .optional()
        .or(z.literal("")),
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
      // 500-char cap so a per-weekday JSON (~250 chars) fits while still
      // bounding the field. Legacy "09:00 – 18:00" strings remain valid.
      if (input.workHours !== undefined) existing.workHours = sanitizeText(input.workHours, 500);
      if (input.workHoursFrom !== undefined || input.workHoursTo !== undefined) {
        const wh: Record<string, unknown> =
          typeof existing.workHours === "object" && existing.workHours !== null
            ? { ...(existing.workHours as Record<string, unknown>) }
            : {};
        if (input.workHoursFrom !== undefined) wh.from = input.workHoursFrom;
        if (input.workHoursTo !== undefined) wh.to = input.workHoursTo;
        existing.workHours = wh;
      }
      if (input.masterSchedulePolicy !== undefined) {
        existing.masterSchedulePolicy = input.masterSchedulePolicy;
      }
      // Mirror name into salon JSON so the Worker bot's `showAdminSettings`
      // (`src/ui/admin.js` reads `ctx.tenant.salon.name`) renders the
      // current name without falling back to the legacy env default.
      // Without this mirror the bot showed "—" for any tenant whose
      // `salon` JSON predated this PR (e.g. seed-script tenants where
      // only `tenants.name` was populated).
      const sanitizedName = input.name !== undefined ? sanitizeText(input.name, 200) : undefined;
      if (sanitizedName !== undefined) existing.name = sanitizedName;

      const tenantUpdate: Record<string, unknown> = { salon: JSON.stringify(existing) };
      if (sanitizedName !== undefined) tenantUpdate.name = sanitizedName;
      if (input.slug !== undefined) tenantUpdate.slug = input.slug || null;
      if (input.description !== undefined) tenantUpdate.description = input.description ? sanitizeText(input.description, 1000) : null;
      if (input.city !== undefined) tenantUpdate.city = input.city ? sanitizeText(input.city, 100) : null;
      if (input.lat !== undefined) tenantUpdate.lat = input.lat;
      if (input.lng !== undefined) tenantUpdate.lng = input.lng;
      if (input.mapsUrl !== undefined) tenantUpdate.mapsUrl = input.mapsUrl || null;
      if (input.publicActive !== undefined) tenantUpdate.publicActive = input.publicActive;
      if (input.chatEnabled !== undefined) tenantUpdate.chatEnabled = input.chatEnabled;
      if (input.photos !== undefined) tenantUpdate.photos = JSON.stringify(input.photos);
      if (input.logo !== undefined) tenantUpdate.logo = input.logo || null;
      if (input.coverPhoto !== undefined) tenantUpdate.coverPhoto = input.coverPhoto || null;
      if (input.displayName !== undefined) tenantUpdate.displayName = input.displayName ? sanitizeText(input.displayName, 120) : null;
      if (input.logoR2Key !== undefined) tenantUpdate.logoR2Key = input.logoR2Key || null;
      if (input.coverR2Key !== undefined) tenantUpdate.coverR2Key = input.coverR2Key || null;
      if (input.bgImage !== undefined) tenantUpdate.bgImage = input.bgImage || null;
      if (input.bgR2Key !== undefined) tenantUpdate.bgR2Key = input.bgR2Key || null;
      if (input.brandPalette !== undefined) {
        tenantUpdate.brandPalette = input.brandPalette ? JSON.stringify(input.brandPalette) : null;
      }
      if (input.instagramUrl !== undefined) {
        tenantUpdate.instagramUrl = input.instagramUrl ? sanitizeText(input.instagramUrl, 300) : null;
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
   * 0074 — read per-channel "auto-suggest favorite master" settings.
   *
   * Defaults to ON for both surfaces because the auto-suggest is a
   * purely additive convenience (the user can always override the
   * pre-pick in the master Select / Telegram keyboard). Source-of-
   * truth defaults mirror Worker `services/services.js:getFavoriteSuggest`.
   *
   * Stored in `tenant_config` under `fav_suggest_{channel}`. We
   * deliberately don't lump them into one JSON blob so the bot can
   * read just `fav_suggest_telegram` without parsing.
   */
  getAutoSuggestFavoriteSettings: tenantOwnerProcedure
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
        web: parse("fav_suggest_web", true),
        telegram: parse("fav_suggest_telegram", true),
      };
    }),

  /**
   * 0074 — toggle "auto-suggest favorite master" for one channel.
   * Mirrors the setAutoConfirm shape so the settings UI can reuse the
   * same switch component.
   */
  setAutoSuggestFavorite: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      channel: z.enum(["web", "telegram"]),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const key = `fav_suggest_${input.channel}`;
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
      kind: z.enum(["logo", "cover", "background", "photo", "portfolio", "service_photo", "client_avatar", "master_avatar", "cancellation_feedback"]),
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
        uid: ctx.webUser?.id,
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
        // 0062: chat-id based adds (Telegram identity owned by the master).
        origin: "invited_telegram",
      });
      // Also assign tenant_roles entry so master can access the mini-app
      const now = Math.floor(Date.now() / 1000);
      await ctx.db.insert(tenantRoles)
        .values({ tenantId: input.tenantId, chatId: input.chatId, role: "master", createdAt: now })
        .onConflictDoUpdate({ target: [tenantRoles.tenantId, tenantRoles.chatId], set: { role: "master", createdAt: now } });

      // 0093: auto-add the new master to the salon's default "Команда" group.
      // Fire-and-forget — the helper swallows errors so a messenger glitch
      // never blocks role assignment.
      void addMasterToDefaultGroup(ctx.db, input.tenantId, input.chatId);

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "role.master.add",
        tenantId: input.tenantId,
        detail: `chatId=${input.chatId}`,
        ip: ctxIp(ctx),
      });
      // #P1-5 (relax.md §5) — best-effort master_invite email. The caller
      // supplies a Telegram chatId, so the only path to an email is via a
      // pre-existing web_users row bound to the same tenant + matching the
      // synthetic-chatId derivation. Telegram-only masters (no web_users
      // row) receive their invitation through the bot DM — no email is
      // sent and that's by design.
      let inviteEmailSent = false;
      try {
        const tenantRow = await ctx.db
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        const salonName = tenantRow[0]?.name ?? "ManicBot";
        const webRows = await ctx.db
          .select({ email: webUsers.email, lang: webUsers.lang })
          .from(webUsers)
          .where(and(eq(webUsers.tenantId, input.tenantId), eq(webUsers.role, "master")));
        for (const wu of webRows) {
          const synth =
            10_000_000_000 + (parseInt(wu.email.replace(/[^a-f0-9]/gi, "").slice(0, 8) || "0", 16) % 1_000_000_000);
          // We don't have a reliable synth → email mapping for arbitrary
          // chat ids; we only send when an email exists for this tenant.
          // Pick the first master web_users row whose derived id matches the
          // chatId, otherwise skip.
          if (wu.email && synth === input.chatId) {
            // #3 — was `void`: a fire-and-forget fetch is torn down on
            // Cloudflare Pages once the response returns. Await + surface.
            const sendResult = await sendMasterInviteEmail(
              wu.email,
              salonName,
              "Master",
              (wu.lang as Lang | null) ?? "en",
            );
            inviteEmailSent = sendResult?.ok === true;
            break;
          }
        }
      } catch (e) {
        log.error("salon.addMaster.email", e instanceof Error ? e : new Error(String(e)));
      }
      return { success: true, inviteEmailSent };
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

  /**
   * Show/hide a master on the public salon profile.
   *
   * Booksy parity: owner can hide a master from /salon/[slug] without
   * deleting them. The master still works internally (assigned to
   * bookings, sees own schedule, master dashboard works) — only the
   * public directory & profile master list filter them out.
  /**
   * Owner reviews a master's pending schedule-change request (master_approval
   * policy). On approval the proposed `{from,to}` + workDays are re-validated
   * and written to the master's row; on denial nothing is applied. Either way
   * the request is closed, audited, and the master gets a bell notification.
   */
  reviewMasterScheduleRequest: tenantOwnerProcedure
    .input(z.object({
      requestId: z.string(),
      decision: z.enum(["approved", "denied"]),
      ownerNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });
      // tenant-scan-ignore: load-by-id to read the row's tenant; assertTenantOwner(req.tenantId) authorizes immediately below.
      const [req] = await ctx.db
        .select()
        .from(tenantActionRequests)
        .where(eq(tenantActionRequests.id, input.requestId))
        .limit(1);
      if (!req) throw new TRPCError({ code: "NOT_FOUND" });
      await assertTenantOwner(ctx, req.tenantId);
      if (req.action !== "master.schedule_change") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "not_a_schedule_request" });
      }
      if (req.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "request_already_reviewed" });
      }

      const now = Math.floor(Date.now() / 1000);
      let payload: { masterId?: unknown; workHours?: unknown; workDays?: unknown } = {};
      try { payload = req.payload ? JSON.parse(req.payload) : {}; } catch { /* malformed */ }

      if (input.decision === "approved") {
        const masterId = typeof payload.masterId === "number" ? payload.masterId : null;
        if (masterId === null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "malformed_request_payload" });
        }
        // Re-validate against the booking-engine shape before applying. Accept
        // both the per-day `{days}` schedule (preferred) and the legacy pair.
        const setObj: Record<string, unknown> = {};
        if (typeof payload.workHours === "string") {
          const perDay = decodeMasterSchedule(payload.workHours);
          if (perDay) {
            const v = validateMasterSchedule(perDay);
            if (!v.ok) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `invalid_master_schedule_${v.reason}` });
            }
            setObj.workHours = serializeMasterSchedule(perDay);
            setObj.workDays = serializeMasterWorkDays(deriveWorkDaysFromSchedule(perDay));
          } else {
            const parsed = parseMasterHours(payload.workHours);
            if (!parsed || !isValidMasterHours(parsed.from, parsed.to)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_hours" });
            }
            setObj.workHours = serializeMasterHours(parsed.from, parsed.to);
          }
        }
        if (typeof payload.workDays === "string" && setObj.workDays === undefined) {
          const parsed = parseMasterWorkDays(payload.workDays);
          if (parsed === null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_work_days" });
          }
          setObj.workDays = serializeMasterWorkDays(parsed);
        }
        if (Object.keys(setObj).length > 0) {
          await ctx.db.update(masters).set(setObj)
            .where(and(eq(masters.tenantId, req.tenantId), eq(masters.chatId, masterId)));
        }
      }

      await ctx.db
        .update(tenantActionRequests)
        .set({
          status: input.decision === "approved" ? "executed" : "denied",
          ownerNote: input.ownerNote ?? null,
          reviewedBy: ctx.webUser.id,
          reviewedAt: now,
        })
        .where(eq(tenantActionRequests.id, input.requestId));

      await ctx.db.insert(auditLog).values({
        tenantId: req.tenantId,
        actor: ctx.webUser.email ?? null,
        action: `master.schedule_${input.decision}`,
        detail: JSON.stringify({ requestId: input.requestId, masterId: payload.masterId ?? null }),
        ip: null,
        createdAt: now,
      });

      // Best-effort bell to the master in their own language.
      const [wu] = await ctx.db
        .select({ lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, req.requesterId))
        .limit(1);
      const supported = ["ru", "ua", "en", "pl"];
      const lang = (typeof wu?.lang === "string" && supported.includes(wu.lang))
        ? (wu.lang as Lang)
        : "en";
      const approved = input.decision === "approved";
      await notifyOrCapture(
        ctx.db,
        {
          webUserId: req.requesterId,
          kind: "approval",
          tenantId: req.tenantId,
          title: t(approved ? "notify.scheduleApproved.title" : "notify.scheduleDenied.title", lang),
          body: t(approved ? "notify.scheduleApproved.body" : "notify.scheduleDenied.body", lang),
          link: "?tab=schedule",
          sourceSlug: "schedule_review",
          sourceId: req.id,
        },
        { path: "salon.reviewMasterScheduleRequest" },
      );

      return { success: true };
    }),

  /** Owner lists outstanding master schedule-change requests (with payload). */
  listPendingScheduleRequests: tenantOwnerProcedure
    .input(tenantIdInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select()
        .from(tenantActionRequests)
        .where(and(
          eq(tenantActionRequests.tenantId, input.tenantId),
          eq(tenantActionRequests.action, "master.schedule_change"),
          eq(tenantActionRequests.status, "pending"),
        ))
        .orderBy(desc(tenantActionRequests.createdAt))
        .limit(100);
      return rows.map((r) => {
        let payload: unknown = null;
        try { payload = r.payload ? JSON.parse(r.payload) : null; } catch { /* ignore */ }
        return { id: r.id, requesterId: r.requesterId, createdAt: r.createdAt, payload };
      });
    }),

  /**
   * Implemented via `masters.public_hidden` (migration 0060).
   */
  setMasterPublicHidden: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number(),
      hidden: z.number().min(0).max(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(masters)
        .set({ publicHidden: input.hidden })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.chatId)));
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: input.hidden ? "master.public.hide" : "master.public.show",
        tenantId: input.tenantId,
        detail: `chatId=${input.chatId}`,
        ip: ctxIp(ctx),
      });
      return { success: true };
    }),

  /**
   * Update the master avatar (emoji or uploaded photo URL).
   *
   * Intentionally NOT origin-gated: the avatar is the salon's visual label
   * for the master on the public profile (same as `publicHidden`), not the
   * master's personal profile data. Any tenant owner may update it.
   *
   * Rule: picking a photo clears avatarEmoji; picking an emoji clears
   * avatarUrl. Passing both null resets to the default ('💅').
   */
  updateMasterAvatar: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number(),
      avatarEmoji: z.string().max(10).nullable(),
      avatarUrl: z.string().max(2000).nullable(),
      avatarR2Key: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db.update(masters)
        .set({
          avatarEmoji: input.avatarEmoji ?? null,
          avatarUrl: input.avatarUrl ?? null,
          avatarR2Key: input.avatarR2Key ?? null,
        })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.chatId)));
      return { success: true };
    }),

  /**
   * Owner-side edit of a master's profile fields. Powers the per-row detail
   * modal on /dashboard?tab=masters (parity with the Clients tab UX).
   *
   * Origin gating (migration 0063 — see `masters.origin`):
   *   - salon_created    → always editable (the salon owns the account)
   *   - invited_email    → editable only if `allowDelegation = 1`
   *   - invited_telegram → editable only if `allowDelegation = 1`
   *   - self_registered  → never editable by the owner; the master owns
   *                        their own profile (use master.updateProfile)
   *
   * Vacation rules mirror master.setVacation: both-or-neither, range no
   * longer than 2 years, `on_vacation` derived from now ∈ [from, until].
   * A plain `onVacation` toggle without dates clears any pinned range
   * when flipped to 0 — same contract as master.updateWorkHours.
   */
  updateMaster: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      chatId: z.number(),
      name: z.string().min(1).max(200).optional(),
      tgUsername: z.string().max(64).nullable().optional(),
      bio: z.string().max(500).nullable().optional(),
      photo: z.string().max(2000).nullable().optional(),
      // Per-master booking schedule. Preferred wire format is `workSchedule` —
      // the per-day `{"days":{…}}` JSON (per-day hours + one optional break).
      // The legacy `{from,to}` + 0..6 weekday array is still accepted for
      // backward compatibility (see ~/lib/workHours + src/services/appointments.js).
      workSchedule: z.string().max(2000).optional(),
      workHours: z.string().max(200).optional(),
      workDays: z.string().max(200).optional(),
      onVacation: z.number().min(0).max(1).optional(),
      vacationFrom: z.number().int().nullable().optional(),
      vacationUntil: z.number().int().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      // Origin / delegation gate — load the master row first so the owner
      // cannot accidentally rewrite a self-registered master's profile.
      const [master] = await ctx.db
        .select({
          origin: masters.origin,
          allowDelegation: masters.allowDelegation,
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.chatId)))
        .limit(1);

      if (!master) {
        throw new TRPCError({ code: "NOT_FOUND", message: "master_not_found" });
      }
      if (master.origin === "self_registered") {
        throw new TRPCError({ code: "FORBIDDEN", message: "master_owns_profile" });
      }
      if (
        (master.origin === "invited_email" || master.origin === "invited_telegram")
        && !master.allowDelegation
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "delegation_required" });
      }

      const setObj: Record<string, unknown> = {};
      if (input.name !== undefined) setObj.name = sanitizeText(input.name, 200);
      if (input.tgUsername !== undefined) {
        setObj.tgUsername = input.tgUsername ? sanitizeText(input.tgUsername, 64) : null;
      }
      if (input.bio !== undefined) {
        setObj.bio = input.bio ? sanitizeText(input.bio, 500) : null;
      }
      if (input.photo !== undefined) {
        setObj.photo = input.photo ? input.photo : null;
      }

      // Schedule — validate + normalize to the booking-engine shape. The field
      // gates real bookable slots, so reject malformed input rather than store
      // junk the Worker would silently ignore. Prefer the per-day `workSchedule`
      // shape; fall back to the legacy `{from,to}` + workDays pair.
      if (input.workSchedule !== undefined) {
        const state = decodeMasterSchedule(input.workSchedule);
        if (!state) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_schedule" });
        }
        const v = validateMasterSchedule(state);
        if (!v.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `invalid_master_schedule_${v.reason}` });
        }
        setObj.workHours = serializeMasterSchedule(state);
        setObj.workDays = serializeMasterWorkDays(deriveWorkDaysFromSchedule(state));
      } else {
        if (input.workHours !== undefined) {
          const parsed = parseMasterHours(input.workHours);
          if (!parsed || !isValidMasterHours(parsed.from, parsed.to)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_hours" });
          }
          setObj.workHours = serializeMasterHours(parsed.from, parsed.to);
        }
        if (input.workDays !== undefined) {
          const parsed = parseMasterWorkDays(input.workDays);
          if (parsed === null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "invalid_master_work_days" });
          }
          setObj.workDays = serializeMasterWorkDays(parsed);
        }
      }

      const hasVacFrom = input.vacationFrom !== undefined;
      const hasVacUntil = input.vacationUntil !== undefined;
      if (hasVacFrom || hasVacUntil) {
        if (hasVacFrom !== hasVacUntil) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "vacationFrom and vacationUntil must both be set or both be null",
          });
        }
        const from = input.vacationFrom ?? null;
        const until = input.vacationUntil ?? null;
        if ((from == null) !== (until == null)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "vacationFrom and vacationUntil must both be set or both be null",
          });
        }
        if (from == null && until == null) {
          setObj.vacationFrom = null;
          setObj.vacationUntil = null;
          setObj.onVacation = 0;
        } else if (from != null && until != null) {
          if (until < from) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "vacationUntil must be on or after vacationFrom",
            });
          }
          const MAX_RANGE = 2 * 365 * 24 * 60 * 60;
          if (until - from > MAX_RANGE) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Vacation range cannot exceed 2 years",
            });
          }
          const now = Math.floor(Date.now() / 1000);
          setObj.vacationFrom = from;
          setObj.vacationUntil = until;
          setObj.onVacation = from <= now && now <= until ? 1 : 0;
        }
      } else if (input.onVacation !== undefined) {
        setObj.onVacation = input.onVacation;
        if (input.onVacation === 0) {
          setObj.vacationFrom = null;
          setObj.vacationUntil = null;
        }
      }

      if (Object.keys(setObj).length === 0) {
        return { success: true };
      }

      await ctx.db.update(masters)
        .set(setObj)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.chatId)));

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "tenant.master.update",
        tenantId: input.tenantId,
        detail: `chatId=${input.chatId}; fields=${Object.keys(setObj).join(",")}`,
        ip: ctxIp(ctx),
      });
      return { success: true };
    }),

  createMasterAccount: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      name: z.string().min(1).max(200),
      email: z.string().email().optional(),
      // Permission template applied on creation. Defaults to MASTER_DEFAULT
      // (the 5 own-scope keys). Owner can change via the Staff tab later.
      permissionTemplate: z.enum(["default", "stylist_plus", "read_only", "custom"]).default("default"),
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
      // 0065: salon-owned accounts also keep a reversibly-encrypted copy of
      // the plaintext so the owner can peek/reset via OTP.
      // Degrade gracefully if BOT_ENCRYPTION_KEY is unset — account is created
      // without the encrypted copy; peek/reset-password features will be
      // unavailable until the key is configured on Pages.
      const passwordEncrypted = await encryptMasterPassword(password, env.BOT_ENCRYPTION_KEY ?? null);
      if (!passwordEncrypted) {
        log.error(
          "salon.createMasterAccount",
          new Error("BOT_ENCRYPTION_KEY missing or <32 chars on Pages env — password_encrypted will be NULL. Set it via `wrangler pages secret put BOT_ENCRYPTION_KEY --project-name admin-app`"),
        );
      }
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);

      // Synthetic chatId (same formula as webUsers.register)
      const syntheticChatId = 10_000_000_000 + (parseInt(id.replace(/-/g, "").slice(0, 8), 16) % 1_000_000_000);

      const sanitizedName = sanitizeText(input.name, 200);

      // Decide permission set up-front so the batch is one shot.
      let permsToGrant: PermissionKey[] = [];
      if (input.permissionTemplate === "default") permsToGrant = MASTER_DEFAULT;
      else if (input.permissionTemplate === "stylist_plus") permsToGrant = PERMISSION_TEMPLATES.stylist_plus;
      else if (input.permissionTemplate === "read_only") permsToGrant = PERMISSION_TEMPLATES.read_only;

      // Build every INSERT as a single D1 batch so the four touched tables
      // (web_users, masters, tenant_roles, tenant_member_permissions) commit
      // all-or-nothing. Pre-fix: web_users row was written first, and if any
      // subsequent INSERT threw (e.g. a missing migration column) we'd leave
      // an orphan web_users row that blocked retries with "email already
      // exists". Found in prod when migration 0074 was missing on D1 and the
      // master Drizzle schema referenced telegram_chat_id even though the
      // INSERT didn't list it — the partial-state bug was the real damage,
      // the migration was just the trigger.
      const insertWebUser = ctx.db.insert(webUsers).values({
        id,
        email: login,
        passwordHash,
        passwordEncrypted, // 0065: owner-recoverable plaintext (AES-GCM)
        role: "master",
        tenantId: input.tenantId,
        name: sanitizedName,
        // Synthetic *.salon.manicbot.local mailboxes are auto-verified
        // (no real inbox to confirm); real addresses follow the standard
        // verification flow before login.
        emailVerified: input.email ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      });
      // isSynthetic=1 because chatId is synthetic (0052). origin='salon_created'
      // — salon owns credentials and may peek/reset via OTP (0062 + 0066).
      // webUserId binds master row to the auth identity for S-01/S-03 checks.
      const insertMaster = ctx.db.insert(masters).values({
        tenantId: input.tenantId,
        chatId: syntheticChatId,
        name: sanitizedName,
        active: 1,
        addedAt: now,
        webUserId: id,
        isSynthetic: 1,
        origin: "salon_created",
      });
      const insertTenantRole = ctx.db.insert(tenantRoles)
        .values({ tenantId: input.tenantId, chatId: syntheticChatId, role: "master", createdAt: now })
        .onConflictDoUpdate({ target: [tenantRoles.tenantId, tenantRoles.chatId], set: { role: "master", createdAt: now } });
      const permInserts = permsToGrant.map((p) =>
        ctx.db.insert(tenantMemberPermissions).values({
          tenantId: input.tenantId,
          webUserId: id,
          permission: p,
          grantedAt: now,
          grantedBy: ctx.webUser!.id,
        }).onConflictDoUpdate({
          target: [tenantMemberPermissions.tenantId, tenantMemberPermissions.webUserId, tenantMemberPermissions.permission],
          set: { grantedAt: now, grantedBy: ctx.webUser!.id },
        }),
      );

      try {
        // D1 batch is atomic — first failure rolls back every prior statement
        // in the same batch. Fall back to sequential awaits when running
        // outside D1 (tests against the mock db, or libsql integration).
        const batchCapable = typeof (ctx.db as unknown as { batch?: unknown }).batch === "function";
        if (batchCapable) {
          const batch = [insertWebUser, insertMaster, insertTenantRole, ...permInserts] as unknown as [unknown, ...unknown[]];
          await (ctx.db as unknown as { batch: (b: typeof batch) => Promise<unknown> }).batch(batch);
        } else {
          await insertWebUser;
          await insertMaster;
          await insertTenantRole;
          for (const p of permInserts) await p;
        }
      } catch (e) {
        // Surface the real failure to the operator (logs + God Mode /errors)
        // while keeping a clean user-facing message. Best-effort cleanup of
        // any partial state when the runtime didn't give us atomicity.
        log.error(
          "salon.createMasterAccount.insert",
          e instanceof Error ? e : new Error(String(e)),
          { tenantId: input.tenantId, login },
        );
        try { await ctx.db.delete(webUsers).where(eq(webUsers.id, id)); } catch { /* noop */ }
        try {
          await ctx.db.delete(masters).where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, syntheticChatId)));
        } catch { /* noop */ }
        try {
          await ctx.db.delete(tenantRoles).where(and(eq(tenantRoles.tenantId, input.tenantId), eq(tenantRoles.chatId, syntheticChatId)));
        } catch { /* noop */ }
        const msg = e instanceof Error ? e.message : String(e);
        // BAD_REQUEST keeps the message visible (errorFormatter doesn't
        // sanitize non-INTERNAL_SERVER_ERROR codes). The message includes
        // the original DB error so the operator can act on it without
        // scraping logs.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Не удалось создать аккаунт мастера: ${msg.slice(0, 200)}`,
        });
      }

      // 0093: auto-add the brand-new web-account master to the salon's
      // default "Команда" group. Fire-and-forget — failure is logged but
      // never aborts the account-creation response (the master would
      // otherwise be stuck without credentials).
      void addMasterToDefaultGroup(ctx.db, input.tenantId, syntheticChatId);

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "tenant.master.create",
        tenantId: input.tenantId,
        detail: `masterId=${syntheticChatId} webUserId=${id} template=${input.permissionTemplate}`,
        ip: ctxIp(ctx),
      });
      // #P1-5 (relax.md §5) — send the master-invite email ONLY when the
      // owner supplied a real address (`input.email`). The auto-generated
      // `*.salon.manicbot.local` mailboxes are synthetic and don't accept
      // mail. We do NOT include the auto-generated password in the email
      // body — it goes back to the caller and the owner shares it through
      // a trusted channel.
      let inviteEmailSent = false;
      if (input.email && input.email.trim()) {
        try {
          const tenantRow = await ctx.db
            .select({ name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, input.tenantId))
            .limit(1);
          const salonName = tenantRow[0]?.name ?? "ManicBot";
          // #3 — was `void`: a fire-and-forget fetch is torn down on Cloudflare
          // Pages once the response returns, so the invite email frequently
          // never sent. Await it and surface `inviteEmailSent` so the UI can
          // warn. The owner also receives the login+password in this response.
          const sendResult = await sendMasterInviteEmail(input.email.trim(), salonName, "Master", "en");
          inviteEmailSent = sendResult?.ok === true;
        } catch (e) {
          log.error("salon.createMasterAccount.email", e instanceof Error ? e : new Error(String(e)));
        }
      }
      return { login, password, masterId: syntheticChatId, webUserId: id, inviteEmailSent };
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
        // PRECONDITION_FAILED so the operator sees the actionable message
        // instead of the generic "Internal server error" sanitization.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Server config error: BOT_ENCRYPTION_KEY is not set on Pages. Set it via `wrangler pages secret put BOT_ENCRYPTION_KEY --project-name admin-app` (must match the Worker value).",
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

      // Referral injection: if the caller has a pending referral row (= they
      // were invited via someone's code), mint a one-shot Stripe coupon for
      // their first invoice and stamp the subscription metadata so the
      // Worker webhook can credit the referrer when invoice.paid fires.
      const referralAttach = await maybeAttachReferral(ctx, cycle);

      const url = await createCheckoutSession(stripeKey, {
        customerId,
        priceId,
        successUrl: `${baseUrl}/settings?section=billing&checkout=success`,
        cancelUrl: `${baseUrl}/settings?section=billing`,
        tenantId: input.tenantId,
        plan: input.plan,
        locale: input.locale,
        billingCycle: cycle,
        couponId: referralAttach?.couponId,
        referralId: referralAttach?.referralId,
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

      const referralAttach = await maybeAttachReferral(ctx, cycle);

      const clientSecret = await createEmbeddedCheckoutSession(stripeKey, {
        customerId,
        priceId,
        returnUrl,
        tenantId: input.tenantId,
        plan: input.plan,
        locale: input.locale,
        billingCycle: cycle,
        couponId: referralAttach?.couponId,
        referralId: referralAttach?.referralId,
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

  /**
   * Disconnect a Meta channel (instagram or whatsapp). Two modes:
   *
   *   - `'soft'` (default) — set `active = 0`, KEEP the encrypted token. The
   *     channel stops receiving / sending but a future `setActive(true)`
   *     restores it without a new OAuth round-trip. Picked when the operator
   *     wants to pause the integration without losing credentials.
   *
   *   - `'hard'` — DELETE the row. Token is gone; reconnecting requires a
   *     fresh OAuth flow. Picked when the operator is transferring the
   *     channel to a different Meta account.
   */
  disconnectChannel: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      channelType: z.enum(["instagram", "whatsapp"]),
      mode: z.enum(["soft", "hard"]).default("soft"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (input.mode === "hard") {
        await ctx.db
          .delete(channelConfigs)
          .where(and(
            eq(channelConfigs.tenantId, input.tenantId),
            eq(channelConfigs.channelType, input.channelType),
          ));
      } else {
        await ctx.db
          .update(channelConfigs)
          .set({ active: 0, updatedAt: Math.floor(Date.now() / 1000) })
          .where(and(
            eq(channelConfigs.tenantId, input.tenantId),
            eq(channelConfigs.channelType, input.channelType),
          ));
      }
      return { ok: true as const, mode: input.mode };
    }),

  /**
   * Re-enable a soft-disconnected channel (`active = 1`). No-ops if there
   * is no row to reactivate.
   */
  reactivateChannel: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      channelType: z.enum(["instagram", "whatsapp"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      await ctx.db
        .update(channelConfigs)
        .set({ active: 1, updatedAt: Math.floor(Date.now() / 1000) })
        .where(and(
          eq(channelConfigs.tenantId, input.tenantId),
          eq(channelConfigs.channelType, input.channelType),
        ));
      return { ok: true as const };
    }),

  /**
   * Send a test Instagram DM from the tenant's bot to a PSID. Diagnostic
   * tool for the salon owner — confirms the token is alive and the channel
   * is correctly bound to a Meta IG account. Returns Meta's raw response
   * (or an `outside_message_window` sentinel) so the operator sees the
   * verdict directly.
   */
  sendInstagramTestMessage: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      psid: z.string().min(1).max(64),
      text: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const workerUrl = env.WORKER_PUBLIC_URL;
      const adminKey = env.ADMIN_KEY;
      if (!workerUrl || !adminKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Server not configured for test send.",
        });
      }
      const res = await fetch(`${workerUrl}/admin/ig-send-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminKey}` },
        body: JSON.stringify({ tenantId: input.tenantId, psid: input.psid, text: input.text }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json() as {
        ok?: boolean;
        sendRes?: { ok: boolean; error?: string };
        api?: string;
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        const reason = data.sendRes?.error || data.error || "send_failed";
        throw new TRPCError({
          code: res.status === 404 ? "NOT_FOUND" : "BAD_REQUEST",
          message: reason,
        });
      }
      return { ok: true as const, api: data.api ?? null, sendRes: data.sendRes };
    }),

  /**
   * Health snapshot for the tenant's Instagram channel.
   *
   * Reads three signals from D1 (no Worker round-trip):
   *  - `channel_configs` row: active flag, token presence, token age (proxy for
   *    Meta Page-token TTL, since Meta issues 60-day tokens by default).
   *  - `message_windows`: most recent inbound IGSID timestamp — proves
   *    inbound is reaching the Worker and `handleInbound` is firing.
   *  - `error_events`: any open instagram-related fingerprint in the last
   *    30 days; matches the auto-deactivation event emitted by
   *    `channels/instagram.js` when the Page token dies.
   *
   * State machine matches the four-color UI in `IGHealthCard.tsx`:
   *  - `not_configured` — no row in channel_configs.
   *  - `needs_attention` — active=0 OR token missing OR open IG error.
   *  - `warning` — healthy DB state but no inbound in 7d.
   *  - `healthy` — active, token present, inbound within 7d, no open errors.
   */
  getInstagramHealth: tenantOwnerProcedure
    .input(tenantIdInput)
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const nowSec = Math.floor(Date.now() / 1000);

      const cfgRows = await ctx.db
        .select({
          id: channelConfigs.id,
          active: channelConfigs.active,
          tokenEncrypted: channelConfigs.tokenEncrypted,
          tokenExpiresAt: channelConfigs.tokenExpiresAt,
          pageId: channelConfigs.pageId,
          igBusinessId: channelConfigs.igBusinessId,
          config: channelConfigs.config,
          createdAt: channelConfigs.createdAt,
          updatedAt: channelConfigs.updatedAt,
        })
        .from(channelConfigs)
        .where(and(
          eq(channelConfigs.tenantId, input.tenantId),
          eq(channelConfigs.channelType, "instagram"),
        ))
        .limit(1);

      if (!cfgRows.length) {
        return {
          configured: false as const,
          state: "not_configured" as const,
          active: false,
          hasToken: false,
          lastInboundAt: null as number | null,
          hoursSinceLastInbound: null as number | null,
          tokenAgeDays: null as number | null,
          lastError: null as { message: string; lastSeen: number; count: number } | null,
          pageId: null as string | null,
          igBusinessId: null as string | null,
          updatedAt: null as number | null,
        };
      }
      const cfg = cfgRows[0]!;

      const [inboundRow] = await ctx.db
        .select({ last: sql<number | null>`MAX(${messageWindows.lastUserMessageAt})` })
        .from(messageWindows)
        .where(and(
          eq(messageWindows.tenantId, input.tenantId),
          eq(messageWindows.channelType, "instagram"),
        ));
      const lastInboundAt = inboundRow?.last ?? null;
      const hoursSinceLastInbound = lastInboundAt
        ? Math.floor((nowSec - lastInboundAt) / 3600)
        : null;

      // PR 3 (2026-05-18): match by structured `error_type` slug instead of
      // substring search on `message`. Slugs come from
      // ~/server/api/channelErrorTypes.ts (mirror of the Worker constants).
      // The legacy `LIKE %message%` fallback is gone — once a row in
      // error_events lacks a slug, the IGHealthCard intentionally won't
      // surface it (those rows pre-date PR 3 and would have been pinged by
      // the operator already).
      const errorRows = await ctx.db
        .select({
          message: errorEvents.message,
          errorType: errorEvents.errorType,
          lastSeen: errorEvents.lastSeen,
          count: errorEvents.count,
        })
        .from(errorEvents)
        .where(and(
          eq(errorEvents.tenantId, input.tenantId),
          eq(errorEvents.status, "open"),
          gte(errorEvents.lastSeen, nowSec - 30 * 86400),
          inArray(errorEvents.errorType, IG_ALL_ERROR_TYPES as unknown as string[]),
        ))
        .orderBy(desc(errorEvents.lastSeen))
        .limit(1);
      const lastError = errorRows[0]
        ? {
            message: errorRows[0].message,
            errorType: errorRows[0].errorType,
            lastSeen: errorRows[0].lastSeen,
            count: errorRows[0].count,
          }
        : null;

      const active = cfg.active === 1;
      const hasToken = !!cfg.tokenEncrypted;
      const tokenAgeDays = hasToken && cfg.updatedAt
        ? Math.floor((nowSec - cfg.updatedAt) / 86400)
        : null;

      // Broken = a "this channel cannot deliver" slug is open. Degraded
      // slugs (subscription_lost, signature_mismatch) keep the state at
      // `warning` instead of jumping straight to broken so the operator
      // gets a different copy + the test-message dialog stays available.
      const hasBrokenError = lastError
        ? (IG_BROKEN_ERROR_TYPES as readonly string[]).includes(lastError.errorType ?? "")
        : false;

      let state: "healthy" | "warning" | "needs_attention" | "broken";
      if (!active || !hasToken) state = "needs_attention";
      else if (hasBrokenError) state = "broken";
      else if (lastError) state = "warning";
      else if (lastInboundAt && nowSec - lastInboundAt < 7 * 86400) state = "healthy";
      else state = "warning";

      return {
        configured: true as const,
        state,
        active,
        hasToken,
        lastInboundAt,
        hoursSinceLastInbound,
        tokenAgeDays,
        lastError,
        pageId: cfg.pageId,
        igBusinessId: cfg.igBusinessId,
        updatedAt: cfg.updatedAt,
      };
    }),

  // ─── Masters tab overhaul (migrations 0062-0066) ──────────────────────────

  /**
   * Invite a master by email. Two scenarios decided at send time:
   *   - existing_user → email links to /invitations/{id}; recipient logs in
   *     to accept (session auth = security, no token needed).
   *   - new_user      → email contains a magic /register?invite=<token> link;
   *     hashed token in D1, raw token only in the email body.
   *
   * Rate-limit: 10 invitations / hour per inviter web_user.
   * Personal-tenant guard: rejects (no one else to invite — single-human tenant).
   */
  sendMasterInvitation: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      email: z.string().email().max(254),
      displayName: z.string().min(1).max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const inviter = ctx.webUser;
      if (!inviter?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      const email = input.email.trim().toLowerCase();

      // Self-invite guard. Compared case-insensitively; the inviter is already
      // tenant_owner of this tenant, sending an invite to themselves does
      // nothing useful and historically created a confusing pending row that
      // could not be accepted (email_mismatch on the accept page).
      if (inviter.email && inviter.email.trim().toLowerCase() === email) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot_invite_self" });
      }

      // Personal-tenant guard.
      const tenantRow = await ctx.db
        .select({ name: tenants.name, isPersonal: tenants.isPersonal })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenantRow[0]) throw new TRPCError({ code: "NOT_FOUND", message: "tenant_not_found" });
      if (tenantRow[0].isPersonal === 1) {
        throw new TRPCError({ code: "FORBIDDEN", message: "personal_tenant_cannot_invite" });
      }

      // Rate-limit per inviter.
      const rl = await checkRateLimit(
        ctx.db,
        `invite:${inviter.id}`,
        "master_invite",
        10,
        60 * 60 * 1000,
      );
      if (!rl.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "rate_limited" });
      }

      const now = Math.floor(Date.now() / 1000);

      // Resolve scenario.
      const existingUser = await ctx.db
        .select({ id: webUsers.id, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.email, email))
        .limit(1);
      const scenario: "existing_user" | "new_user" =
        existingUser.length > 0 ? "existing_user" : "new_user";

      // Token only used in scenario=new_user. For existing_user we still
      // store a hash (random unused value) so the column stays NOT NULL.
      const rawToken = generateToken();
      const tokenHash = await hashToken(rawToken);
      const invitationId = crypto.randomUUID();

      try {
        await ctx.db.insert(masterInvitations).values({
          id: invitationId,
          tenantId: input.tenantId,
          email,
          inviterUserId: inviter.id,
          invitedName: input.displayName ? sanitizeText(input.displayName, 200) : null,
          tokenHash,
          tokenExpiresAt: now + 7 * 24 * 60 * 60, // 7 days
          status: "pending",
          scenario,
          createdAt: now,
        });
      } catch (e) {
        const msg = String((e as Error)?.message ?? "");
        if (/UNIQUE constraint failed/i.test(msg)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "invitation_already_pending",
          });
        }
        throw e;
      }

      const salonName = tenantRow[0].name ?? "ManicBot";
      const lang = ((existingUser[0]?.lang as Lang | null) ?? "en") as Lang;

      // We AWAIT the email send so the mutation result can carry the verdict.
      // Pre-PR-A the call was fire-and-forget — when RESEND_API_KEY was unset
      // (or Resend returned a 4xx/5xx) the failure landed silently in logs
      // and the UI showed a misleading green toast. Now the call site sees
      // `emailQueued: false` + `transportError` and renders a yellow chip;
      // the operator also sees an `error_events` row in /errors via
      // `captureError`. The sidecar `captureError` is wrapped in try/catch so
      // a D1 hiccup writing the audit row can never break the primary flow.
      let emailQueued = true;
      let transportError: string | undefined;
      // Bell-write verdict (PR-B). Only set on existing_user scenario —
      // new_user has no web_users row yet, so there's no bell row to
      // write. The send-time bell write is the in-app counterpart of
      // the email send; pre-PR-B it was `void notifyWebUser(...)` and
      // got silently dropped on Cloudflare Pages because the D1 binding
      // dies with the request context. See notifyOrCapture.ts for the
      // full mechanism + fix rationale.
      let bellQueued: boolean | undefined;
      let bellSkippedByPrefs = false;
      let bellError: string | undefined;

      if (scenario === "existing_user") {
        const emailResult = await sendMasterInviteExistingUserEmail(email, invitationId, salonName, lang).catch(
          (e): { ok: false; error: string } => {
            log.error("salon.invite.existing", e instanceof Error ? e : new Error(String(e)));
            return { ok: false, error: "send_threw" };
          },
        );
        if (!emailResult.ok) {
          emailQueued = false;
          transportError = emailResult.error;
          try {
            await captureError(ctx.db, {
              errorType: "email.transport_failed",
              severity: "error",
              message: `Master invite email failed (existing_user): ${emailResult.error}`,
              tenantId: input.tenantId,
              userId: inviter.id,
              path: "salon.sendMasterInvitation",
              context: {
                recipient: email,
                scenario: "existing_user",
                reason: emailResult.error,
                invitationId,
              },
            });
          } catch (e) {
            log.warn(
              "salon.invite.captureError_failed",
              e instanceof Error ? { message: e.message } : { raw: String(e) },
            );
          }
        }

        // In-app Bell entry for the invitee. Email is unreliable (spam, DNS,
        // delayed delivery, missing RESEND_API_KEY) — the Bell drop is what
        // guarantees the recipient sees the invite next time they open the
        // dashboard. Idempotent on (web_user_id, source_slug, source_id, kind).
        const inviteeId = existingUser[0]!.id;
        const inviteeLabel = ((): string => {
          switch (lang) {
            case "ru": return `Приглашение от салона «${salonName}»`;
            case "ua": return `Запрошення від салону «${salonName}»`;
            case "pl": return `Zaproszenie od salonu „${salonName}"`;
            default:   return `Invitation from ${salonName}`;
          }
        })();
        const inviteeBody = ((): string => {
          switch (lang) {
            case "ru": return "Вас приглашают присоединиться как мастера. Нажмите, чтобы принять.";
            case "ua": return "Вас запрошують приєднатися як майстра. Натисніть, щоб прийняти.";
            case "pl": return "Zapraszamy Cię do dołączenia jako mistrz. Kliknij, aby zaakceptować.";
            default:   return "You're invited to join as a master. Click to accept.";
          }
        })();
        const bellResult = await notifyOrCapture(
          ctx.db,
          {
            webUserId: inviteeId,
            kind: "master.invite",
            title: inviteeLabel,
            body: inviteeBody,
            link: `/invitations/${invitationId}`,
            tenantId: input.tenantId,
            sourceSlug: "master_invitations",
            sourceId: invitationId,
          },
          {
            path: "salon.sendMasterInvitation",
            userId: inviter.id,
            extraContext: { invitationId, scenario },
          },
        );
        bellQueued = bellResult.bellQueued;
        bellSkippedByPrefs = bellResult.bellSkippedByPrefs === true;
        bellError = bellResult.bellError;
      } else {
        const emailResult = await sendMasterInviteNewUserEmail(email, rawToken, salonName, lang).catch(
          (e): { ok: false; error: string } => {
            log.error("salon.invite.new", e instanceof Error ? e : new Error(String(e)));
            return { ok: false, error: "send_threw" };
          },
        );
        if (!emailResult.ok) {
          emailQueued = false;
          transportError = emailResult.error;
          try {
            await captureError(ctx.db, {
              errorType: "email.transport_failed",
              severity: "error",
              message: `Master invite email failed (new_user): ${emailResult.error}`,
              tenantId: input.tenantId,
              userId: inviter.id,
              path: "salon.sendMasterInvitation",
              context: {
                recipient: email,
                scenario: "new_user",
                reason: emailResult.error,
                invitationId,
              },
            });
          } catch (e) {
            log.warn(
              "salon.invite.captureError_failed",
              e instanceof Error ? { message: e.message } : { raw: String(e) },
            );
          }
        }
      }

      await writeAudit(ctx.db, {
        actor: inviter.email ?? null,
        action: "tenant.master.invite",
        tenantId: input.tenantId,
        detail: `email=${email} scenario=${scenario} emailQueued=${emailQueued}${transportError ? ` transportError=${transportError}` : ""}`,
        ip: ctxIp(ctx),
      });

      return {
        invitationId,
        scenario,
        emailQueued,
        ...(transportError ? { transportError } : {}),
        ...(typeof bellQueued === "boolean" ? { bellQueued } : {}),
        ...(bellSkippedByPrefs ? { bellSkippedByPrefs: true as const } : {}),
        ...(bellError ? { bellError } : {}),
      };
    }),

  /**
   * Read-only context for the accept-invitation page.
   *
   * Returns everything the accept-page needs in a single round-trip so the UI
   * can render a precise, copy-driven warning instead of a generic
   * "Salon invited you". Public-ish: requires a logged-in webUser (the
   * route group middleware enforces this), but does NOT require the caller
   * to be the invitation's recipient — the page itself reveals whether the
   * email matches and routes to /login if not.
   *
   * Fields returned:
   *   - salonName             — the inviting salon (for the headline)
   *   - inviterEmail          — who sent it (helps recipient identify spam)
   *   - status / expiresAt    — drives the "already used / expired" copy
   *   - emailMatch            — true when the caller's email == invitation email
   *   - callerOwnsOtherTenant — true when caller is tenant_owner of a different
   *                              non-personal salon (drives the dual-role warning)
   *   - callerTenantName      — name of caller's own salon (for the warning copy)
   */
  getInvitationContext: protectedProcedure
    .input(z.object({ invitationId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const caller = ctx.webUser;
      if (!caller?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      const rows = await ctx.db
        .select({
          id: masterInvitations.id,
          tenantId: masterInvitations.tenantId,
          email: masterInvitations.email,
          status: masterInvitations.status,
          scenario: masterInvitations.scenario,
          tokenExpiresAt: masterInvitations.tokenExpiresAt,
          inviterUserId: masterInvitations.inviterUserId,
          tenantName: tenants.name,
        })
        .from(masterInvitations)
        .leftJoin(tenants, eq(tenants.id, masterInvitations.tenantId))
        .where(eq(masterInvitations.id, input.invitationId))
        .limit(1);
      const inv = rows[0];
      if (!inv) throw new TRPCError({ code: "NOT_FOUND", message: "invitation_not_found" });

      const inviterRows = await ctx.db
        .select({ email: webUsers.email })
        .from(webUsers)
        .where(eq(webUsers.id, inv.inviterUserId))
        .limit(1);

      // Surface the dual-role warning whenever the caller is a tenant_owner
      // of a different non-personal salon. Lookup is via web_users.tenantId
      // (web_users.role='tenant_owner' rows are linked to their salon there).
      let callerOwnsOtherTenant = false;
      let callerTenantName: string | null = null;
      if (caller.webRole === "tenant_owner" && caller.tenantId && caller.tenantId !== inv.tenantId) {
        const ownedRow = await ctx.db
          .select({ name: tenants.name, isPersonal: tenants.isPersonal })
          .from(tenants)
          .where(eq(tenants.id, caller.tenantId))
          .limit(1);
        if (ownedRow[0] && ownedRow[0].isPersonal !== 1) {
          callerOwnsOtherTenant = true;
          callerTenantName = ownedRow[0].name ?? null;
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      return {
        invitationId: inv.id,
        tenantId: inv.tenantId,
        salonName: inv.tenantName ?? "ManicBot",
        inviterEmail: inviterRows[0]?.email ?? null,
        /** The email the invitation was sent to — surfaced on the accept
         *  page so the recipient can see which account they need to sign
         *  in as when emailMatch is false. */
        email: inv.email,
        status: inv.status,
        scenario: inv.scenario,
        expiresAt: inv.tokenExpiresAt,
        expired: inv.tokenExpiresAt < nowSec,
        emailMatch: (caller.email ?? "").trim().toLowerCase() === inv.email.toLowerCase(),
        callerOwnsOtherTenant,
        callerTenantName,
      };
    }),

  /** Returns pending invitations for the masters-tab strip. */
  listMasterInvitations: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      status: z.enum(["pending", "accepted", "revoked", "expired"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({
          id: masterInvitations.id,
          email: masterInvitations.email,
          invitedName: masterInvitations.invitedName,
          status: masterInvitations.status,
          scenario: masterInvitations.scenario,
          tokenExpiresAt: masterInvitations.tokenExpiresAt,
          createdAt: masterInvitations.createdAt,
        })
        .from(masterInvitations)
        .where(and(
          eq(masterInvitations.tenantId, input.tenantId),
          input.status ? eq(masterInvitations.status, input.status) : eq(masterInvitations.status, "pending"),
        ))
        .orderBy(desc(masterInvitations.createdAt));
      return rows;
    }),

  /** Cancel a pending invitation. No OTP — until accepted, this is a no-op
   *  on the recipient side. The unique partial index automatically frees the
   *  (tenantId, email) slot for a fresh invitation. */
  revokeMasterInvitation: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = Math.floor(Date.now() / 1000);
      const result = await ctx.db
        .update(masterInvitations)
        .set({ status: "revoked", revokedAt: now })
        .where(and(
          eq(masterInvitations.id, input.invitationId),
          eq(masterInvitations.tenantId, input.tenantId),
          eq(masterInvitations.status, "pending"),
        ));
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "tenant.master.invite.revoke",
        tenantId: input.tenantId,
        detail: `invitationId=${input.invitationId}`,
        ip: ctxIp(ctx),
      });
      return { ok: true, result };
    }),

  /**
   * Archive a master (soft-delete). OTP-gated.
   * Does NOT cancel future appointments — owner reassigns separately.
   */
  archiveMaster: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      masterChatId: z.number(),
      otpCode: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      await requireOtpConfirmation({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "archive_master",
        payload: { tenantId: input.tenantId, masterChatId: input.masterChatId },
        code: input.otpCode,
      });

      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .update(masters)
        .set({ archivedAt: now })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)));

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: "tenant.master.archive",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterChatId}`,
        ip: ctxIp(ctx),
      });
      return { ok: true };
    }),

  /** Restore an archived master. OTP-gated. */
  unarchiveMaster: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      masterChatId: z.number(),
      otpCode: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      await requireOtpConfirmation({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "unarchive_master",
        payload: { tenantId: input.tenantId, masterChatId: input.masterChatId },
        code: input.otpCode,
      });

      await ctx.db
        .update(masters)
        .set({ archivedAt: null })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)));

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: "tenant.master.unarchive",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterChatId}`,
        ip: ctxIp(ctx),
      });
      return { ok: true };
    }),

  /**
   * Reset a salon-owned master's password. OTP-gated. Generates a fresh
   * password, hashes + encrypts both columns, emails the plaintext directly
   * to the master. The salon owner never sees the new value in the response.
   * Refuses on origin != 'salon_created' (account is owned by the master).
   */
  resetMasterPassword: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      masterChatId: z.number(),
      otpCode: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      await requireOtpConfirmation({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "reset_master_password",
        payload: { tenantId: input.tenantId, masterChatId: input.masterChatId },
        code: input.otpCode,
      });

      // Master + linked web_user lookup.
      const masterRow = await ctx.db
        .select({
          origin: masters.origin,
          webUserId: masters.webUserId,
          name: masters.name,
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)))
        .limit(1);
      const m = masterRow[0];
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "master_not_found" });
      if (m.origin !== "salon_created") {
        throw new TRPCError({ code: "FORBIDDEN", message: "not_owned_by_salon" });
      }
      if (!m.webUserId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "master_has_no_web_user" });
      }

      const userRow = await ctx.db
        .select({ email: webUsers.email, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, m.webUserId))
        .limit(1);
      if (!userRow[0]?.email) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "master_has_no_email" });
      }

      // Generate fresh password.
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      const pwArr = crypto.getRandomValues(new Uint8Array(16));
      const newPassword = Array.from(pwArr).map((b) => chars[b % chars.length]).join("");
      const passwordHash = await hashPassword(newPassword);
      const passwordEncrypted = await encryptMasterPassword(newPassword, env.BOT_ENCRYPTION_KEY ?? null);
      if (!passwordEncrypted) {
        log.error(
          "salon.resetMasterPassword",
          new Error("BOT_ENCRYPTION_KEY missing or <32 chars on Pages env — password_encrypted will be NULL. Set it via `wrangler pages secret put BOT_ENCRYPTION_KEY --project-name admin-app`"),
        );
      }
      const now = Math.floor(Date.now() / 1000);
      await ctx.db
        .update(webUsers)
        .set({
          passwordHash,
          passwordEncrypted,
          passwordChangedAt: now, // invalidates existing JWTs
          updatedAt: now,
        })
        .where(eq(webUsers.id, m.webUserId));

      const tenantRow = await ctx.db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      const salonName = tenantRow[0]?.name ?? "ManicBot";

      // Look up the OWNER (caller) row for their email + lang. We email the
      // owner, not the master — the master's email is a synthetic
      // `*.salon.manicbot.local` for salon-created accounts.
      const ownerRow = await ctx.db
        .select({ email: webUsers.email, lang: webUsers.lang })
        .from(webUsers)
        .where(eq(webUsers.id, ctx.webUser.id))
        .limit(1);
      const ownerEmail = ownerRow[0]?.email ?? ctx.webUser.email ?? "";
      const ownerLang = ((ownerRow[0]?.lang as Lang | null) ?? "en") as Lang;
      const masterName = m.name ?? "Master";
      const masterLogin = userRow[0].email;

      // #2 — AWAIT the credential email. On Cloudflare Pages a `void` send is
      // torn down when the handler returns, so the new password would never
      // reach the owner and the master would be locked out (the rotation
      // already invalidated the old password). We await + surface emailSent /
      // transportError so the UI can warn and offer a re-send. The rotation is
      // intentionally NOT rolled back — re-issuing the email is the recovery.
      let emailSent = false;
      let transportError: string | null = null;
      if (ownerEmail) {
        try {
          const sendResult = await sendMasterPasswordResetCredentialsToOwnerEmail(
            ownerEmail,
            masterName,
            masterLogin,
            newPassword,
            salonName,
            ownerLang,
          );
          emailSent = sendResult.ok;
          if (!sendResult.ok) {
            transportError = sendResult.error;
            log.error(
              "salon.resetMasterPassword.email",
              new Error(`transport_failed: ${sendResult.error}`),
            );
          }
        } catch (e: unknown) {
          transportError = e instanceof Error ? e.message : String(e);
          log.error(
            "salon.resetMasterPassword.email",
            e instanceof Error ? e : new Error(String(e)),
          );
        }
      } else {
        transportError = "no_owner_email";
      }

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: "tenant.master.password.reset",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterChatId} (credentials emailed to owner; master receives them out-of-band; emailSent=${emailSent})`,
        ip: ctxIp(ctx),
      });

      // Mask the OWNER's email in the response (the recipient of the email).
      const at = ownerEmail.indexOf("@");
      const masked = at > 1 ? `${ownerEmail[0]}***${ownerEmail.slice(at - 1)}` : ownerEmail;
      return { ok: true, emailSentTo: masked, emailSent, transportError };
    }),

  /**
   * Decrypt and return a salon-owned master's plaintext password. OTP-gated.
   * Audit-logged. ONLY for origin='salon_created' accounts. The returned
   * value is the actual password — the salon owner is expected to copy it
   * once and the UI must not persist it.
   *
   * Bootstrap-on-empty-vault: legacy salon_created accounts may have
   * `password_encrypted IS NULL` (created before migration 0066, or when
   * BOT_ENCRYPTION_KEY was missing on Pages env at create-time). For these,
   * the hashed `password_hash` is mathematically irrecoverable, so we
   * generate a fresh password, write the hash+vault blob+passwordChangedAt
   * (invalidating the master's active JWT — same side effect as a manual
   * reset), and return the new plaintext flagged as `bootstrapped: true`.
   * Without BOT_ENCRYPTION_KEY we still refuse: there is no point bootstrapping
   * a password we cannot persist into the vault for a future peek.
   */
  peekMasterPassword: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      masterChatId: z.number(),
      otpCode: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser?.id) throw new TRPCError({ code: "UNAUTHORIZED" });

      await requireOtpConfirmation({
        db: ctx.db,
        webUserId: ctx.webUser.id,
        action: "peek_master_password",
        payload: { tenantId: input.tenantId, masterChatId: input.masterChatId },
        code: input.otpCode,
      });

      const masterRow = await ctx.db
        .select({ origin: masters.origin, webUserId: masters.webUserId })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)))
        .limit(1);
      const m = masterRow[0];
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "master_not_found" });
      if (m.origin !== "salon_created") {
        throw new TRPCError({ code: "FORBIDDEN", message: "not_owned_by_salon" });
      }
      if (!m.webUserId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "master_has_no_web_user" });
      }

      const userRow = await ctx.db
        .select({ passwordEncrypted: webUsers.passwordEncrypted })
        .from(webUsers)
        .where(eq(webUsers.id, m.webUserId))
        .limit(1);
      const blob = userRow[0]?.passwordEncrypted;

      if (!blob) {
        // Bootstrap path — vault empty, generate fresh credential and persist.
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        const pwArr = crypto.getRandomValues(new Uint8Array(16));
        const newPassword = Array.from(pwArr).map((b) => chars[b % chars.length]).join("");
        const newBlob = await encryptMasterPassword(newPassword, env.BOT_ENCRYPTION_KEY ?? null);
        if (!newBlob) {
          // No encryption key on Pages env → refuse. We will not generate a
          // throwaway password the operator can never re-peek.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "password_not_vaulted",
          });
        }
        const passwordHash = await hashPassword(newPassword);
        const now = Math.floor(Date.now() / 1000);
        await ctx.db
          .update(webUsers)
          .set({
            passwordHash,
            passwordEncrypted: newBlob,
            passwordChangedAt: now, // invalidates any active JWT for the master
            updatedAt: now,
          })
          .where(eq(webUsers.id, m.webUserId));

        await writeAudit(ctx.db, {
          actor: ctx.webUser.email ?? null,
          action: "tenant.master.password.bootstrap_and_peek",
          tenantId: input.tenantId,
          detail: `masterChatId=${input.masterChatId} (vault was empty — generated fresh password and revealed to owner)`,
          ip: ctxIp(ctx),
        });

        return { password: newPassword, bootstrapped: true };
      }

      const plain = await decryptMasterPassword(blob, env.BOT_ENCRYPTION_KEY ?? null);
      if (!plain) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "decrypt_failed",
        });
      }

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: "tenant.master.password.peek",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterChatId}`,
        ip: ctxIp(ctx),
      });

      return { password: plain };
    }),

  /** Master detail for the profile drawer (read-only context). */
  getMasterDetail: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), masterChatId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const rows = await ctx.db
        .select({
          chatId: masters.chatId,
          name: masters.name,
          tgUsername: masters.tgUsername,
          bio: masters.bio,
          photo: masters.photo,
          portfolio: masters.portfolio,
          workHours: masters.workHours,
          workDays: masters.workDays,
          publicHidden: masters.publicHidden,
          active: masters.active,
          archivedAt: masters.archivedAt,
          origin: masters.origin,
          isSynthetic: masters.isSynthetic,
          webUserId: masters.webUserId,
          // Vacation + delegation surfaced for the owner-side detail modal
          // (parity with the Clients tab). The modal disables edits for
          // self_registered + invited_* without `allowDelegation`.
          vacationFrom: masters.vacationFrom,
          vacationUntil: masters.vacationUntil,
          onVacation: masters.onVacation,
          allowDelegation: masters.allowDelegation,
          // 0075: avatar fields — read by MasterDetailModal header circle
          avatarEmoji: masters.avatarEmoji,
          avatarUrl: masters.avatarUrl,
          // Joined web_users fields (LEFT JOIN below via subquery — kept simple)
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)))
        .limit(1);
      const m = rows[0];
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "master_not_found" });

      let webUserInfo: {
        email: string;
        emailVerified: number;
        lastLoginAt: number | null;
        hasVaultedPassword: boolean;
      } | null = null;
      if (m.webUserId) {
        const u = await ctx.db
          .select({
            email: webUsers.email,
            emailVerified: webUsers.emailVerified,
            lastLoginAt: webUsers.lastLoginAt,
            passwordEncrypted: webUsers.passwordEncrypted,
          })
          .from(webUsers)
          .where(eq(webUsers.id, m.webUserId))
          .limit(1);
        if (u[0]) {
          webUserInfo = {
            email: u[0].email,
            emailVerified: u[0].emailVerified,
            lastLoginAt: u[0].lastLoginAt,
            hasVaultedPassword: u[0].passwordEncrypted !== null,
          };
        }
      }

      return { ...m, webUser: webUserInfo };
    }),

  // ═══════════════════════════════════════════════════════════════════
  //  0072 — TELEGRAM PAIRING (salon-owner-initiated)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * List all masters in the tenant with their Telegram pairing state.
   *
   * Used by the Salon → Channels → Telegram tab to show a per-master
   * table: name, primary `chatId` (synthetic vs real), `telegramChatId`
   * (paired or NULL), and whether a pending pairing code exists.
   *
   * Authorization: tenant owner. Returns archived masters too — UI can
   * filter / show them dimmed.
   */
  listMasterPairingStates: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = Math.floor(Date.now() / 1000);

      const masterRows = await ctx.db
        .select({
          chatId: masters.chatId,
          name: masters.name,
          isSynthetic: masters.isSynthetic,
          origin: masters.origin,
          archivedAt: masters.archivedAt,
          telegramChatId: masters.telegramChatId,
        })
        .from(masters)
        .where(eq(masters.tenantId, input.tenantId))
        .orderBy(masters.name);

      // Active codes grouped by master_chat_id — one query, then merge in JS.
      const activeCodes = await ctx.db
        .select({
          masterChatId: masterPairingCodes.masterChatId,
          expiresAt: masterPairingCodes.expiresAt,
        })
        .from(masterPairingCodes)
        .where(and(
          eq(masterPairingCodes.tenantId, input.tenantId),
          isNull(masterPairingCodes.consumedAt),
          gt(masterPairingCodes.expiresAt, now),
        ));
      const activeMap = new Map<number, number>();
      for (const c of activeCodes) {
        const prev = activeMap.get(c.masterChatId) ?? 0;
        if (c.expiresAt > prev) activeMap.set(c.masterChatId, c.expiresAt);
      }

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);

      return {
        botUsername: bot?.botUsername ?? null,
        masters: masterRows.map((m) => ({
          chatId: m.chatId,
          name: m.name,
          isSynthetic: m.isSynthetic === 1,
          origin: m.origin,
          archived: m.archivedAt !== null,
          telegramChatId: m.telegramChatId ?? null,
          hasActiveCode: activeMap.has(m.chatId),
          activeCodeExpiresAt: activeMap.get(m.chatId) ?? null,
        })),
      };
    }),

  /**
   * Single-master pairing state. Same shape as one row from
   * `listMasterPairingStates`, plus the salon's `botUsername`.
   *
   * Used by `MasterTelegramInlineSection` inside `MasterDetailModal` so
   * the owner can mint / unpair / manually enter chat_id directly from
   * the per-master detail view, without bouncing to Channels → Telegram.
   *
   * Authorization: tenant owner. Returns 404 if the master doesn't exist
   * in this tenant. Archived rows ARE returned (UI dims them out).
   */
  getMasterPairingState: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), masterChatId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      const now = Math.floor(Date.now() / 1000);

      const [m] = await ctx.db
        .select({
          chatId: masters.chatId,
          isSynthetic: masters.isSynthetic,
          origin: masters.origin,
          archivedAt: masters.archivedAt,
          telegramChatId: masters.telegramChatId,
        })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)))
        .limit(1);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "master_not_found" });

      const [activeCode] = await ctx.db
        .select({ expiresAt: masterPairingCodes.expiresAt })
        .from(masterPairingCodes)
        .where(and(
          eq(masterPairingCodes.tenantId, input.tenantId),
          eq(masterPairingCodes.masterChatId, input.masterChatId),
          isNull(masterPairingCodes.consumedAt),
          gt(masterPairingCodes.expiresAt, now),
        ))
        .orderBy(desc(masterPairingCodes.expiresAt))
        .limit(1);

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);

      return {
        chatId: m.chatId,
        isSynthetic: m.isSynthetic === 1,
        origin: m.origin,
        archived: m.archivedAt !== null,
        telegramChatId: m.telegramChatId ?? null,
        hasActiveCode: !!activeCode,
        activeCodeExpiresAt: activeCode?.expiresAt ?? null,
        botUsername: bot?.botUsername ?? null,
      };
    }),

  /**
   * Salon-owner-initiated pairing mint. Same shape as
   * `master.requestPairingCode` but authorized via `assertTenantOwner`
   * — the owner doesn't need IDOR scoping. Stores
   * `createdByWebUserId = ctx.webUser.id` for attribution.
   */
  createMasterPairingCode: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string(), masterChatId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [m] = await ctx.db
        .select({ archivedAt: masters.archivedAt })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)))
        .limit(1);
      if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Master not found" });
      if (m.archivedAt !== null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Master is archived" });
      }

      const [bot] = await ctx.db
        .select({ botUsername: bots.botUsername })
        .from(bots)
        .where(and(eq(bots.tenantId, input.tenantId), eq(bots.active, 1)))
        .limit(1);
      if (!bot?.botUsername) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Connect a Telegram bot first (Channels → Telegram)",
        });
      }

      const { raw, hash } = await generatePairingToken();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + PAIRING_TOKEN_TTL_SEC;

      await ctx.db.insert(masterPairingCodes).values({
        tokenHash: hash,
        tenantId: input.tenantId,
        masterChatId: input.masterChatId,
        createdByWebUserId: ctx.webUser.id,
        createdAt: now,
        expiresAt,
      });

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: "tenant.master.pairing_code_created",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterChatId}`,
        ip: ctxIp(ctx),
      });

      return {
        deepLink: buildDeepLink(bot.botUsername, raw),
        expiresAt,
      };
    }),

  /**
   * Manual override: salon owner directly sets a master's
   * `telegram_chat_id` (e.g. they have the master's TG ID on hand and
   * want to skip the deep-link round-trip). Setting it to NULL unpairs.
   *
   * The partial UNIQUE `idx_masters_tenant_tg_chat` is enforced — a 409
   * on collision rolls back without partial state.
   */
  setMasterTelegramChatId: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      masterChatId: z.number().int(),
      telegramChatId: z.number().int().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);
      if (!ctx.webUser) throw new TRPCError({ code: "UNAUTHORIZED" });

      const [m] = await ctx.db
        .select({ archivedAt: masters.archivedAt })
        .from(masters)
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)))
        .limit(1);
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });

      // Pre-check the partial UNIQUE so we can return a friendly error
      // instead of a SQLite constraint violation.
      if (input.telegramChatId !== null) {
        const [collision] = await ctx.db
          .select({ chatId: masters.chatId })
          .from(masters)
          .where(and(
            eq(masters.tenantId, input.tenantId),
            eq(masters.telegramChatId, input.telegramChatId),
            ne(masters.chatId, input.masterChatId),
          ))
          .limit(1);
        if (collision) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Этот Telegram уже привязан к другому мастеру в салоне",
          });
        }
      }

      await ctx.db
        .update(masters)
        .set({ telegramChatId: input.telegramChatId })
        .where(and(eq(masters.tenantId, input.tenantId), eq(masters.chatId, input.masterChatId)));

      await writeAudit(ctx.db, {
        actor: ctx.webUser.email ?? null,
        action: input.telegramChatId === null
          ? "tenant.master.telegram_unpaired"
          : "tenant.master.telegram_set",
        tenantId: input.tenantId,
        detail: `masterChatId=${input.masterChatId} telegramChatId=${input.telegramChatId ?? "null"}`,
        ip: ctxIp(ctx),
      });

      return { success: true };
    }),
});
