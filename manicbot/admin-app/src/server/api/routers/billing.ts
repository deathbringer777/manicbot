import { createTRPCRouter, adminProcedure, tenantOwnerProcedure } from "~/server/api/trpc";
import { assertTenantOwner } from "~/server/api/tenantAccess";
import { tenants, subscriptionCancellations, stripeLedger } from "~/server/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PLAN_PRICES_PLN } from "~/lib/money";
import { classifyTenant } from "~/server/metrics/status";
import { writeAudit, ctxIp } from "~/server/security/audit";
import { env } from "~/env";
import {
  retrieveSubscription,
  ensureCoupon,
  applyCouponToSubscription,
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionNow,
  getBalance,
  listPayouts,
  listRecentCharges,
  listDisputes,
  type StripeBalanceResult,
  type StripePayoutRow,
  type StripeChargeRow,
  type StripeDisputeRow,
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

/**
 * The Stripe account is currently SHARED with a previous, unrelated project, so
 * account-global figures (balance, payouts, recent charges, disputes) may
 * include activity that is NOT ManicBot revenue. We expose this flag so the UI
 * labels those widgets as raw shared-account data and never adds them into MRR.
 * Flip to false once ManicBot moves to a dedicated Stripe account.
 */
const STRIPE_ACCOUNT_SHARED = true;

export const billingRouter = createTRPCRouter({
  getOverview: adminProcedure.query(async ({ ctx }) => {
    const now = Math.floor(Date.now() / 1000);
    const allTenants = await ctx.db.select().from(tenants).orderBy(desc(tenants.createdAt));

    // Classify every tenant through the shared metrics module so test tenants,
    // expired trials, grant/promo "active" tenants AND secondary salons
    // (parent_tenant_id, via classifyTenant) never inflate revenue or counts.
    // Real MRR == active billing_status WITH a real Stripe subscription only.
    let comped = 0;
    let activeTrials = 0;
    let churned = 0;
    let testCount = 0;
    let mrr = 0;
    const planBreakdown: Record<string, number> = {};

    for (const t of allTenants) {
      const c = classifyTenant(t, now);
      if (c.isTest) {
        testCount += 1;
        continue;
      }
      switch (c.bucket) {
        case "paying": {
          // Real recurring revenue (active or in-dunning with a Stripe sub).
          mrr += c.mrrPln;
          const plan = t.plan ?? "start";
          planBreakdown[plan] = (planBreakdown[plan] ?? 0) + 1;
          break;
        }
        case "comped":
          comped += 1;
          break;
        case "trialing":
          activeTrials += 1;
          break;
        case "churned":
          churned += 1;
          break;
      }
    }

    // Ops-table status tallies (non-test, raw status). `activeSubscribers` is
    // clean active subs only; dunning states (grace_period / past_due) are
    // shown under `grace`, not folded into active.
    const activeSubscribers = allTenants.filter(
      (t) => !t.isTest && t.billingStatus === "active" && !!t.stripeSubscriptionId,
    ).length;
    const grace = allTenants.filter((t) => !t.isTest && t.billingStatus === "grace_period").length;
    const inactive = allTenants.filter(
      (t) => !t.isTest && (!t.billingStatus || t.billingStatus === "inactive"),
    ).length;

    return {
      metrics: {
        mrr,
        arr: mrr * 12,
        totalTenants: allTenants.length,
        testTenants: testCount,
        activeSubscribers, // clean active subs (non-test, real Stripe sub)
        comped, // granted/promo access, zero revenue
        trialing: activeTrials, // non-expired trials only
        grace,
        inactive,
        churned,
        planBreakdown,
      },
      tenants: allTenants.map((t) => ({
        id: t.id,
        name: t.name,
        plan: t.plan ?? "start",
        billingStatus: t.billingStatus ?? "inactive",
        parentTenantId: t.parentTenantId,
        isTest: t.isTest ?? 0,
        email: t.billingEmail,
        stripeCustomerId: t.stripeCustomerId,
        stripeSubscriptionId: t.stripeSubscriptionId,
        trialEndsAt: t.trialEndsAt,
        currentPeriodEnd: t.currentPeriodEnd,
        cancelAtPeriodEnd: t.cancelAtPeriodEnd,
        createdAt: t.createdAt,
        // Real recurring revenue for this row (0 unless truly paying).
        monthlyRevenue: classifyTenant(t, now).mrrPln,
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

  /**
   * God-Mode force-cancel — operator escape hatch for the "cancelled with us
   * but Stripe keeps charging" divergence. Pulls the LIVE subscription from
   * Stripe (never trusts the denormalized `tenants` flags) and cancels it:
   *   - `immediate`   → DELETE the sub now, stop billing this instant.
   *   - `period_end`  → flip cancel_at_period_end, let the paid period run out.
   * Then mirrors the result into D1 so the dashboard matches reality. `tenantId`
   * is always taken from explicit input (God-Mode rule — never inferred).
   *
   * If Stripe says the subscription is already gone (404 → null), we don't
   * error: we just reconcile the local row to `inactive` and report it.
   */
  forceCancelSubscription: adminProcedure
    .input(
      z.object({
        tenantId: z.string(),
        mode: z.enum(["immediate", "period_end"]).default("immediate"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      const [tenant] = await ctx.db
        .select({
          id: tenants.id,
          stripeSubscriptionId: tenants.stripeSubscriptionId,
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

      const now = Math.floor(Date.now() / 1000);
      const sub = await retrieveSubscription(stripeKey, tenant.stripeSubscriptionId);

      // Subscription already gone in Stripe — nothing left to charge. Reconcile
      // the local row so the dashboard stops claiming an active subscription.
      if (!sub) {
        await ctx.db
          .update(tenants)
          .set({
            billingStatus: "inactive",
            subscriptionStatus: "canceled",
            stripeSubscriptionId: null,
            stripePriceId: null,
            currentPeriodEnd: null,
            nextPaymentDate: null,
            cancelAtPeriodEnd: 0,
            updatedAt: now,
          })
          .where(eq(tenants.id, input.tenantId));
        await writeAudit(ctx.db, {
          actor: ctx.webUser?.email ?? null,
          action: "billing.forceCancelSubscription",
          tenantId: input.tenantId,
          detail: `mode=${input.mode} result=already_gone sub=${tenant.stripeSubscriptionId}`,
          ip: ctxIp(ctx),
        });
        return { ok: true as const, mode: input.mode, result: "already_gone" as const };
      }

      if (input.mode === "period_end") {
        const updated = await cancelSubscriptionAtPeriodEnd(stripeKey, tenant.stripeSubscriptionId);
        await ctx.db
          .update(tenants)
          .set({ cancelAtPeriodEnd: 1, updatedAt: now })
          .where(eq(tenants.id, input.tenantId));
        await writeAudit(ctx.db, {
          actor: ctx.webUser?.email ?? null,
          action: "billing.forceCancelSubscription",
          tenantId: input.tenantId,
          detail: `mode=period_end sub=${tenant.stripeSubscriptionId}`,
          ip: ctxIp(ctx),
        });
        return {
          ok: true as const,
          mode: "period_end" as const,
          result: "scheduled" as const,
          cancelAt: updated.current_period_end ?? null,
        };
      }

      // immediate — stop billing now.
      await cancelSubscriptionNow(stripeKey, tenant.stripeSubscriptionId);
      await ctx.db
        .update(tenants)
        .set({
          billingStatus: "inactive",
          subscriptionStatus: "canceled",
          stripeSubscriptionId: null,
          stripePriceId: null,
          currentPeriodEnd: null,
          nextPaymentDate: null,
          cancelAtPeriodEnd: 0,
          updatedAt: now,
        })
        .where(eq(tenants.id, input.tenantId));
      await writeAudit(ctx.db, {
        actor: ctx.webUser?.email ?? null,
        action: "billing.forceCancelSubscription",
        tenantId: input.tenantId,
        detail: `mode=immediate sub=${tenant.stripeSubscriptionId}`,
        ip: ctxIp(ctx),
      });
      return { ok: true as const, mode: "immediate" as const, result: "canceled" as const };
    }),

  // ─── God Mode real-money dashboard (Stage 2) ──────────────────────────────
  // Live Stripe state the D1 mirror can't hold: balance, payouts, recent
  // charges, open disputes. Each section is fetched independently and a failure
  // is isolated to that section (Promise.allSettled) so a Stripe blip degrades
  // one widget, never the whole dashboard — this read never throws.
  getStripeFinancials: adminProcedure.query(async () => {
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return {
        configured: false,
        liveMode: null as boolean | null,
        sharedAccount: STRIPE_ACCOUNT_SHARED,
        balance: null as StripeBalanceResult | null,
        payouts: { rows: [] as StripePayoutRow[], error: false },
        charges: { rows: [] as StripeChargeRow[], error: false },
        disputes: { rows: [] as StripeDisputeRow[], error: false },
        errors: [] as string[],
      };
    }

    const [balanceR, payoutsR, chargesR, disputesR] = await Promise.allSettled([
      getBalance(secretKey),
      listPayouts(secretKey, { limit: 10 }),
      listRecentCharges(secretKey, { limit: 12 }),
      listDisputes(secretKey, { limit: 10 }),
    ]);

    const errors: string[] = [];
    const note = (tag: string, r: PromiseRejectedResult) => {
      errors.push(tag);
      log.warn(`billing.financials.${tag}Failed`, {
        err: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    };
    if (balanceR.status === "rejected") note("balance", balanceR);
    if (payoutsR.status === "rejected") note("payouts", payoutsR);
    if (chargesR.status === "rejected") note("charges", chargesR);
    if (disputesR.status === "rejected") note("disputes", disputesR);

    return {
      configured: true,
      liveMode: secretKey.startsWith("sk_live_"),
      sharedAccount: STRIPE_ACCOUNT_SHARED,
      balance: balanceR.status === "fulfilled" ? balanceR.value : null,
      payouts: { rows: payoutsR.status === "fulfilled" ? payoutsR.value.data : [], error: payoutsR.status === "rejected" },
      charges: { rows: chargesR.status === "fulfilled" ? chargesR.value.data : [], error: chargesR.status === "rejected" },
      disputes: { rows: disputesR.status === "fulfilled" ? disputesR.value.data : [], error: disputesR.status === "rejected" },
      errors,
    };
  }),

  // Multi-month real revenue from the D1 `stripe_ledger` mirror (synced by the
  // Worker cron). Fast + historical — no live Stripe call on load. Buckets
  // balance transactions by day for the chart, plus an estimated-MRR-vs-actual-
  // net reconciliation. All money is Stripe minor units (PLN grosze).
  getLedgerSummary: adminProcedure
    .input(z.object({ days: z.number().int().min(7).max(365).default(90) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 90;
      const now = Math.floor(Date.now() / 1000);
      const windowFloor = now - days * 86400;
      const floor30 = now - 30 * 86400;

      const rows = await ctx.db
        .select({
          type: stripeLedger.type,
          amount: stripeLedger.amount,
          fee: stripeLedger.fee,
          net: stripeLedger.net,
          created: stripeLedger.created,
        })
        .from(stripeLedger)
        .where(gte(stripeLedger.created, windowFloor))
        .orderBy(stripeLedger.created);

      // Bucket by UTC day. `gross` counts only positive-revenue charges; `net`
      // is the true bottom line (refunds/disputes pull it down); `fee` is the
      // Stripe cut.
      const byDay = new Map<string, { date: string; gross: number; net: number; fee: number }>();
      for (const r of rows) {
        const date = new Date((r.created ?? 0) * 1000).toISOString().slice(0, 10);
        const bucket = byDay.get(date) ?? { date, gross: 0, net: 0, fee: 0 };
        if (r.type === "charge") bucket.gross += r.amount ?? 0;
        bucket.net += r.net ?? 0;
        bucket.fee += r.fee ?? 0;
        byDay.set(date, bucket);
      }
      const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
      const totals = series.reduce(
        (t, s) => ({ gross: t.gross + s.gross, net: t.net + s.net, fee: t.fee + s.fee }),
        { gross: 0, net: 0, fee: 0 },
      );

      const actualNet30dMinor = rows
        .filter((r) => (r.created ?? 0) >= floor30)
        .reduce((s, r) => s + (r.net ?? 0), 0);

      const tenantRows = await ctx.db
        .select({ plan: tenants.plan, billingStatus: tenants.billingStatus })
        .from(tenants);
      // Estimated MRR is whole PLN (plan prices); convert to grosze so the
      // reconciliation compares like-for-like with the minor-unit ledger net.
      const estimatedMrr = tenantRows
        .filter((t) => t.billingStatus === "active")
        .reduce((s, t) => s + (PLAN_PRICES_PLN[t.plan ?? "start"] ?? 0), 0);
      const estimatedMrrMinor = estimatedMrr * 100;

      return {
        windowDays: days,
        series,
        totals,
        reconciliation: {
          estimatedMrrMinor,
          actualNet30dMinor,
          deltaMinor: actualNet30dMinor - estimatedMrrMinor,
        },
      };
    }),

  // ─── Retention flow (migration 0087) ──────────────────────────────────────
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
      // NOTE: we intentionally do NOT short-circuit on the denormalized
      // `tenant.cancelAtPeriodEnd` flag here. It can drift out of sync with
      // Stripe (a dropped webhook, an out-of-band un-cancel), and trusting it
      // would trap an owner whose Stripe sub is actually still renewing into a
      // permanent "already_cancelling" error while Stripe keeps charging. The
      // live `sub.cancel_at_period_end` check below is the single source of truth.

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

      // #S2-1 — cooldown re-check + idempotency. This MUST happen before we
      // touch Stripe. Previously only `requestCancellation` (the read step)
      // computed eligibility, so a client that re-POSTed acceptRetentionOffer
      // (double-click, network retry, or a hostile replay) re-applied the
      // coupon — and `applyCouponToSubscription` RESETS the coupon's repeating
      // window on Stripe every call, yielding an unbounded stacking discount.
      // Re-running the same cooldown query the read step uses makes the
      // mutation self-gating and idempotent: the first accept writes a
      // retention_offer_accepted=1 row, and any subsequent accept inside the
      // window finds it and is refused with FORBIDDEN before the coupon apply.
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
      if (recentAccepted) {
        throw new TRPCError({ code: "FORBIDDEN", message: "offer_not_eligible" });
      }

      // STRIPE-OFFER-01 — re-derive the offer from the LIVE subscription; never
      // trust the client's `offerType`. The two offers carry different coupon
      // economics (monthly = 50% repeating for 3 months; annual = 25% once). A
      // repeating-3-month coupon applied to a YEARLY invoice discounts the whole
      // year (the single invoice that falls inside the 3-month window), so an
      // annual subscriber sending `monthly_50_3m` would get 50% off a full year
      // instead of 25%. Reject any offerType that doesn't match the real billing
      // interval BEFORE minting or applying anything.
      const sub = await retrieveSubscription(stripeKey, tenant.stripeSubscriptionId);
      if (!sub) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "stripe_subscription_missing" });
      }
      const subItem = sub.items?.data?.[0];
      const subInterval =
        subItem?.price?.recurring?.interval ?? subItem?.plan?.interval ?? "month";
      const expectedOfferType: RetentionOfferType =
        subInterval === "year" ? "annual_25_1y" : "monthly_50_3m";
      if (input.offerType !== expectedOfferType) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "offer_type_mismatch" });
      }

      const offer = RETENTION_OFFERS[input.offerType];
      const intervalAtCancel = subInterval === "year" ? "year" : "month";

      // #S2-3 — claim the cooldown row BEFORE applying the (window-resetting)
      // coupon. applyCouponToSubscription RESETS a repeating coupon's window on
      // every call, so a re-apply STACKS the −50% discount (unbounded money
      // loss). If the cooldown claim were written only AFTER a successful apply,
      // an apply-ok-but-insert-fail crash would leave no cooldown row and a
      // retry would re-apply. Writing the claim first makes the worst case a
      // benign "cooldown set without the discount applied" (recoverable by
      // support) instead of a stacking discount. Mirrors confirmCancellation's
      // row-before-Stripe discipline.
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

      await ensureCoupon(stripeKey, offer.code, offer.percentOff, {
        duration: offer.duration,
        months: "months" in offer ? offer.months : undefined,
      });
      await applyCouponToSubscription(stripeKey, tenant.stripeSubscriptionId, offer.code);

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

      const stripeKey = env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stripe not configured" });
      }

      // Live Stripe state is authoritative — never the denormalized
      // `tenant.cancelAtPeriodEnd` flag (it can drift and would otherwise trap
      // the owner in "already_cancelling" while Stripe keeps charging). We need
      // the sub anyway to record `interval_at_cancel`.
      const sub = await retrieveSubscription(stripeKey, tenant.stripeSubscriptionId);
      if (!sub) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "stripe_subscription_missing" });
      }
      if (sub.cancel_at_period_end === true) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "already_cancelling" });
      }
      const item = sub.items?.data?.[0];
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
