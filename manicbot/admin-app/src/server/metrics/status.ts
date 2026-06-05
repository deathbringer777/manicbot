/**
 * Billing-status taxonomy + per-tenant classification — the single source of
 * truth for "is this salon paying / trialing / comped / churned?".
 *
 * Why this exists: metric queries used to be scattered across `metrics.ts`,
 * `billing.ts` and `platformCustomers.ts`, each with its own (inconsistent)
 * idea of what counts. That produced inflated MRR (test tenants + expired
 * trials + grant-code "active" tenants all counted as real revenue) and a
 * desynced status vocabulary (the code writes `grace_period` but the old
 * classifier matched `grace`; `inactive`/`unpaid` matched nothing).
 *
 * Rule of thumb: pull rows with the cheap SQL pre-filter (`is_test = 0`),
 * then run every row through {@link classifyTenant} here. The classifier is
 * pure and fully unit-tested, and re-checks `is_test` defensively so a row
 * that slips past the SQL filter still cannot inflate a business number.
 */

import { PLAN_PRICES_PLN } from "~/lib/money";

/** Coarse business bucket a tenant falls into for KPI purposes. */
export type BillingBucket = "paying" | "comped" | "trialing" | "churned" | "none";

/** The minimal tenant shape the classifier needs (loose nulls from D1). */
export interface ClassifiableTenant {
  plan: string | null;
  billingStatus: string | null;
  trialEndsAt: number | null;
  /** Real Stripe subscription id. Absent ⇒ access was granted, not paid for. */
  stripeSubscriptionId: string | null;
  isTest?: number | boolean | null;
}

export interface TenantClassification {
  bucket: BillingBucket;
  /** Monthly recurring revenue in PLN this tenant *actually* contributes. */
  mrrPln: number;
  isTest: boolean;
  /** Granted/promo access (active status, no real Stripe subscription). */
  isComped: boolean;
  /** A trial that has not yet expired. */
  isActiveTrial: boolean;
}

/**
 * Stripe subscriber states. A tenant in one of these IS a real customer iff it
 * also carries a Stripe subscription id; `grace_period`/`past_due` are dunning
 * states of an existing subscription, not churn.
 */
const PAYING_STRIPE_STATES = new Set(["active", "grace_period", "past_due"]);
const TRIAL_STATES = new Set(["trialing", "trial"]);
/**
 * Terminal / non-monetized states. Includes both Stripe spellings (`canceled`)
 * and the British spelling (`cancelled`) the app has historically written, plus
 * `inactive`/`unpaid` which the old classifier silently dropped.
 */
const DEAD_STATES = new Set([
  "expired",
  "canceled",
  "cancelled",
  "inactive",
  "unpaid",
  "incomplete_expired",
  "paused",
  "incomplete",
]);

/** PLN monthly price for a plan key; unknown/empty ⇒ 0. */
export function planPricePln(plan: string | null): number {
  if (!plan) return 0;
  return PLAN_PRICES_PLN[plan] ?? 0;
}

/**
 * Classify one tenant for KPI math. Pure: depends only on its arguments.
 *
 * @param t      tenant row (plan, billing_status, trial_ends_at, stripe sub, is_test)
 * @param nowSec current time in unix seconds (injected for testability)
 */
export function classifyTenant(t: ClassifiableTenant, nowSec: number): TenantClassification {
  const none = (over: Partial<TenantClassification> = {}): TenantClassification => ({
    bucket: "none",
    mrrPln: 0,
    isTest: false,
    isComped: false,
    isActiveTrial: false,
    ...over,
  });

  // Test tenants never contribute to any business number.
  if (t.isTest) return none({ isTest: true });

  const status = (t.billingStatus ?? "").trim();

  // Trials count only while they have not expired.
  if (TRIAL_STATES.has(status)) {
    const active = t.trialEndsAt != null && t.trialEndsAt > nowSec;
    return active
      ? { bucket: "trialing", mrrPln: 0, isTest: false, isComped: false, isActiveTrial: true }
      : { bucket: "churned", mrrPln: 0, isTest: false, isComped: false, isActiveTrial: false };
  }

  // Active-family: a real Stripe subscription ⇒ paying; otherwise the access
  // was granted (grant/promo code, manual activation) ⇒ comped, zero revenue.
  if (PAYING_STRIPE_STATES.has(status)) {
    if (t.stripeSubscriptionId) {
      // A null plan falls back to `start` — the tenants.plan column default —
      // so a real subscription is never priced at 0 just because plan is unset.
      return { bucket: "paying", mrrPln: planPricePln(t.plan ?? "start"), isTest: false, isComped: false, isActiveTrial: false };
    }
    return { bucket: "comped", mrrPln: 0, isTest: false, isComped: true, isActiveTrial: false };
  }

  if (DEAD_STATES.has(status)) {
    return { bucket: "churned", mrrPln: 0, isTest: false, isComped: false, isActiveTrial: false };
  }

  return none();
}

/**
 * Coarse family of a raw `billing_status` string, independent of trial expiry
 * or subscription presence. Use for display/grouping; use {@link classifyTenant}
 * for any number that feeds a KPI.
 */
export function normalizeBillingStatus(raw: string | null): BillingBucket {
  const s = (raw ?? "").trim();
  if (PAYING_STRIPE_STATES.has(s)) return "paying";
  if (TRIAL_STATES.has(s)) return "trialing";
  if (DEAD_STATES.has(s)) return "churned";
  return "none";
}

/** Exposed for tests + reuse by sibling metric modules. */
export const __testing = { PAYING_STRIPE_STATES, TRIAL_STATES, DEAD_STATES };
