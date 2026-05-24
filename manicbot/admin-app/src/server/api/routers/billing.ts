import { createTRPCRouter, adminProcedure, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { tenants, subscriptionCancellations } from "~/server/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PLAN_PRICES_PLN } from "~/lib/money";
import { writeAudit, ctxIp } from "~/server/security/audit";
import { env } from "~/env";
import {
  retrieveSubscription,
  ensureCoupon,
  applyCouponToSubscription,
  cancelSubscriptionAtPeriodEnd,
} from "~/server/lib/stripe";
import { sendSubscriptionCancelledEmail } from "~/server/email/emailService";
import { sanitizeText } from "~/server/security/sanitize";
import { log } from "~/server/utils/logger";
import type { Lang } from "~/lib/i18n";

// ─── Retention coupon catalogue ─────────────────────────────────────────────
// Hardcoded by design — these aren't configurable per-tenant. If we ever
// want to A/B alternative offers, we'll add a slug column to the table and
// surface it through the offer-eligibility response.
export const RETENTION_OFFERS = {
  monthly_50_3m: {
    code: "RETENTION_MONTHLY_50_3M",
    percentOff: 50,
    duration: "repeating" as const,
    months: 3,
  },
  annual_25_1y: {
    code: "RETENTION_ANNUAL_25_1Y",
    percentOff: 25,
    duration: "once" as const,
  },
} as const;

export type RetentionOfferType = keyof typeof RETENTION_OFFERS;

// 12-month cooldown — once a tenant accepts a retention offer, they cannot
// be offered another one for a year. Burns the retention budget on serial
// "threaten-to-cancel" abusers if absent.
const RETENTION_OFFER_COOLDOWN_SEC = 365 * 24 * 60 * 60;

// Closed enum of churn reasons. Stored as JSON array in `reason_tags`.
export const CANCELLATION_REASON_ENUM = [
  "too_expensive",
  "no_clients",
  "confusing_ui",
  "bad_support",
  "switched_competitor",
  "temporary_break",
  "other",
] as const;

/**
 * Defense against arbitrary URL injection in `photo_url`. Photos must come
 * from our own R2 / Worker domain — never an attacker-controlled host. The
 * WORKER_PUBLIC_URL hostname is the upload origin; AUTH_URL is checked too
 * because the Worker may eventually mirror assets there.
 */
function isAllowedPhotoUrl(url: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const workerHost = env.WORKER_PUBLIC_URL ? new URL(env.WORKER_PUBLIC_URL).host : null;
    const authHost = process.env.AUTH_URL ? new URL(process.env.AUTH_URL).host : null;
    return u.host === workerHost || u.host === authHost;
  } catch {
    return false;
  }
}

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

  // ─── Retention flow (migration 0086) ──────────────────────────────────────
  // Three-step cancellation:
  //   1. requestCancellation — does the user qualify for a counter-offer?
  //   2. acceptRetentionOffer — they accepted, apply discount, write audit row.
  //   3. confirmCancellation — they declined the offer (or there was none),
  //      collect reason+free text+optional photo, flip Stripe cancel_at_period_end.

  /**
   * Step 1 — eligibility probe.
   *
   * Returns whether the caller is eligible for a counter-offer and which one
   * (`monthly_50_3m` for month-cadence subs, `annual_25_1y` for year-cadence).
   * The frontend uses this to decide whether to render Stage 1 of the modal.
   *
   * Ineligible cases:
   *   - subscription already cancel_at_period_end
   *   - subscription is not active/trialing in Stripe
   *   - this tenant already accepted a retention offer in the last 12 months
   *   - no Stripe subscription on file (nothing to cancel)
   */
  requestCancellation: tenantOwnerProcedure
    .input(z.object({ tenantId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [tenant] = await ctx.db
        .select({
          id: tenants.id,
          plan: tenants.plan,
          billingStatus: tenants.billingStatus,
          stripeSubscriptionId: tenants.stripeSubscriptionId,
          cancelAtPeriodEnd: tenants.cancelAtPeriodEnd,
        })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);

      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }
      if (!tenant.stripeSubscriptionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "no_active_subscription",
        });
      }
      if (tenant.cancelAtPeriodEnd) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "already_cancelling",
        });
      }

      // Pull live subscription state from Stripe so we know the cadence
      // (the column is not denormalized into `tenants`). This also catches
      // the case where someone cancelled out-of-band in the Stripe dashboard.
      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      const sub = await retrieveSubscription(stripeKey, tenant.stripeSubscriptionId);
      if (!sub) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "stripe_subscription_missing" });
      }
      if (sub.cancel_at_period_end) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "already_cancelling" });
      }
      if (sub.status !== "active" && sub.status !== "trialing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `subscription_not_cancelable:${sub.status}`,
        });
      }

      // Detect interval. Stripe exposes it at items.data[0].plan.interval
      // (legacy) and items.data[0].price.recurring.interval (modern). Try
      // modern first.
      const item = sub.items?.data?.[0];
      const interval =
        item?.price?.recurring?.interval ?? item?.plan?.interval ?? "month";

      // Cooldown — has this tenant accepted any retention offer in the last
      // year? If so, no counter-offer this time. We still let them proceed
      // to Stage 2 (reason collection) → Stage 3 (confirm).
      const nowSec = Math.floor(Date.now() / 1000);
      const cooldownFloor = nowSec - RETENTION_OFFER_COOLDOWN_SEC;
      const [recentAccepted] = await ctx.db
        .select({ id: subscriptionCancellations.id })
        .from(subscriptionCancellations)
        .where(
          and(
            eq(subscriptionCancellations.tenantId, input.tenantId),
            eq(subscriptionCancellations.retentionOfferAccepted, 1),
            gte(subscriptionCancellations.createdAt, cooldownFloor),
          ),
        )
        .limit(1);

      const inCooldown = !!recentAccepted;

      const offerType: RetentionOfferType =
        interval === "year" ? "annual_25_1y" : "monthly_50_3m";

      return {
        eligibleForOffer: !inCooldown,
        offerType: inCooldown ? null : offerType,
        currentPlan: (tenant.plan ?? "start") as "start" | "pro" | "max",
        currentInterval: (interval === "year" ? "year" : "month") as "month" | "year",
        stripeSubId: tenant.stripeSubscriptionId,
      };
    }),

  /**
   * Step 2 — user clicked "Accept the offer".
   *
   * Mints (idempotently) the corresponding Stripe coupon, applies it to the
   * subscription, writes an audit row marked `retention_offer_accepted=1`,
   * and does NOT cancel. A subsequent attempt to cancel in the next year
   * will be served `eligibleForOffer: false` by `requestCancellation`.
   */
  acceptRetentionOffer: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      offerType: z.enum(["monthly_50_3m", "annual_25_1y"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      const [tenant] = await ctx.db
        .select({
          id: tenants.id,
          plan: tenants.plan,
          stripeSubscriptionId: tenants.stripeSubscriptionId,
        })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant?.stripeSubscriptionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "no_active_subscription" });
      }

      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      const offer = RETENTION_OFFERS[input.offerType];
      await ensureCoupon(stripeKey, offer.code, offer.percentOff, {
        duration: offer.duration,
        months: "months" in offer ? offer.months : undefined,
      });
      await applyCouponToSubscription(stripeKey, tenant.stripeSubscriptionId, offer.code);

      const nowSec = Math.floor(Date.now() / 1000);
      const intervalAtCancel = input.offerType === "annual_25_1y" ? "year" : "month";

      await ctx.db.insert(subscriptionCancellations).values({
        tenantId: input.tenantId,
        webUserId: ctx.webUser?.id ?? "",
        planAtCancel: tenant.plan ?? null,
        intervalAtCancel,
        reasonTags: "[]",
        freeText: null,
        photoUrl: null,
        retentionOfferShown: 1,
        retentionOfferAccepted: 1,
        retentionCouponCode: offer.code,
        createdAt: nowSec,
      });

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "billing.acceptRetentionOffer",
        tenantId: input.tenantId,
        detail: `offer=${input.offerType} coupon=${offer.code}`,
        ip: ctxIp(ctx),
      });

      return {
        applied: true,
        couponCode: offer.code,
        percentOff: offer.percentOff,
      };
    }),

  /**
   * Step 3 — user declined the offer (or never saw one) and confirmed cancel.
   *
   * Writes the structured churn row, flips Stripe cancel_at_period_end, then
   * fires the "we're sorry to see you go" email. Email send is fire-and-forget
   * so a Resend hiccup never blocks the cancel.
   *
   * The DB row is written BEFORE the Stripe call so a Stripe network error
   * cannot strand us with a cancelled sub and no audit trail. If Stripe fails,
   * we throw and the audit row stays — operator can inspect later.
   */
  confirmCancellation: tenantOwnerProcedure
    .input(z.object({
      tenantId: z.string(),
      reasonTags: z
        .array(z.enum(CANCELLATION_REASON_ENUM))
        .min(1, "at_least_one_reason_required")
        .max(CANCELLATION_REASON_ENUM.length),
      freeText: z.string().max(2000).optional(),
      photoUrl: z.string().url().optional(),
      retentionOfferShown: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertTenantOwner(ctx, input.tenantId);

      if (input.photoUrl && !isAllowedPhotoUrl(input.photoUrl)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "photo_url_invalid_host",
        });
      }

      const [tenant] = await ctx.db
        .select({
          id: tenants.id,
          plan: tenants.plan,
          billingEmail: tenants.billingEmail,
          stripeSubscriptionId: tenants.stripeSubscriptionId,
          cancelAtPeriodEnd: tenants.cancelAtPeriodEnd,
        })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tenant not found" });
      }
      if (!tenant.stripeSubscriptionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "no_active_subscription" });
      }
      if (tenant.cancelAtPeriodEnd) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "already_cancelling" });
      }

      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      // Need the live subscription so we can record `interval_at_cancel`.
      const sub = await retrieveSubscription(stripeKey, tenant.stripeSubscriptionId);
      const item = sub?.items?.data?.[0];
      const interval = item?.price?.recurring?.interval ?? item?.plan?.interval ?? "month";

      const nowSec = Math.floor(Date.now() / 1000);
      const sanitizedFreeText = input.freeText ? sanitizeText(input.freeText, 2000) : null;

      // 1. Write audit row first — this MUST land even if Stripe is down.
      await ctx.db.insert(subscriptionCancellations).values({
        tenantId: input.tenantId,
        webUserId: ctx.webUser?.id ?? "",
        planAtCancel: tenant.plan ?? null,
        intervalAtCancel: interval,
        reasonTags: JSON.stringify(input.reasonTags),
        freeText: sanitizedFreeText,
        photoUrl: input.photoUrl ?? null,
        retentionOfferShown: input.retentionOfferShown ? 1 : 0,
        retentionOfferAccepted: 0,
        retentionCouponCode: null,
        createdAt: nowSec,
      });

      // 2. Flip Stripe. If this throws, the audit row stays and the caller
      //    sees an error — operator can re-run the cancel manually later.
      const updated = await cancelSubscriptionAtPeriodEnd(stripeKey, tenant.stripeSubscriptionId);

      // 3. Reflect cancel_at_period_end locally so the dashboard renders the
      //    "cancelled — active until …" pill immediately (the webhook will
      //    eventually do this too, but UI cannot wait 200ms for it).
      await ctx.db
        .update(tenants)
        .set({
          cancelAtPeriodEnd: 1,
          updatedAt: nowSec,
        })
        .where(eq(tenants.id, input.tenantId));

      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "billing.confirmCancellation",
        tenantId: input.tenantId,
        detail: `reasons=${input.reasonTags.join(",")} hasFreeText=${!!sanitizedFreeText} hasPhoto=${!!input.photoUrl}`,
        ip: ctxIp(ctx),
      });

      // 4. Fire the "sorry to see you go" email — best-effort.
      const recipient = tenant.billingEmail ?? ctx.webUser?.email;
      if (recipient) {
        const lang = (ctx.webUser as { lang?: string } | undefined)?.lang ?? "en";
        sendSubscriptionCancelledEmail(recipient, lang as Lang).catch((err) =>
          log.warn("billing.cancelEmailFailed", { err: err instanceof Error ? err.message : String(err) }),
        );
      }

      return {
        ok: true as const,
        cancelAt: updated.current_period_end ?? null,
      };
    }),
});

/**
 * Type-only re-export so frontend code can `import type { RetentionOfferType }`
 * without pulling the whole router.
 */
export type { RetentionOfferType as BillingRetentionOfferType };
