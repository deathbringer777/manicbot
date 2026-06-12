/**
 * Pure billing-state helpers shared between the server (auth.getMyRole lazy-flip)
 * and the client (BillingGate render decision). Keeping them dependency-free makes
 * them trivially testable and impossible to drift between layers.
 *
 * Mirror of the Worker's `isInactive()` (manicbot/src/billing/features.js) plus the
 * UI rule from BillingSection.tsx: a tenant is "trial expired" when the trial flip
 * has happened (`billingStatus === 'inactive'`) AND no Stripe customer exists yet
 * (i.e. the owner never started a paid subscription).
 */

import type { AppRole } from "~/server/api/routers/auth";

/**
 * Roles whose access to the dashboard is gated by tenant billing.
 * system_admin / support / technical_support are platform staff and bypass the gate.
 */
const BILLING_GATED_ROLES: ReadonlySet<AppRole> = new Set<AppRole>([
  "tenant_owner",
  "tenant_manager",
  "master",
]);

/**
 * Routes that MUST remain reachable even when the trial-expired gate is active.
 * /settings: the resolve path (?section=billing — where BillingGate's CTA goes)
 *            plus the account-level escape hatch (password change, logout).
 * /plugins, /plugin/*: allow unsubscribing from paid plugin add-ons without paying first.
 *
 * /billing is deliberately NOT here (DC-14, audit 2026-06-12): it is a
 * god-mode page, not the tenant resolve path. Because it is also absent from
 * FULL_PAGE_ROUTE_PREFIXES, a gated tenant role navigating to /billing gets
 * the SalonDashboard swap — listing it as a bypass rendered the full
 * dashboard for a locked tenant.
 */
const GATE_BYPASS_PREFIXES = ["/settings", "/plugins", "/plugin/"] as const;

export function isBillingGatedRole(role: AppRole): boolean {
  return BILLING_GATED_ROLES.has(role);
}

export function isGateBypassPath(pathname: string): boolean {
  return GATE_BYPASS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || (p.endsWith("/") && pathname.startsWith(p)));
}

/**
 * Inputs we read from the tenants table to decide trial state.
 * All timestamps are Unix seconds (matches the D1 schema).
 */
export interface TenantBillingInput {
  billingStatus: string | null;
  trialEndsAt: number | null;
  stripeCustomerId: string | null;
  /**
   * Presence of a real Stripe subscription. Used to tell a complimentary grant
   * (active, no subscription) apart from a real paying account. Optional so the
   * many existing call sites that predate it default to "no subscription".
   */
  stripeSubscriptionId?: string | null;
}

/**
 * Result of evaluating a tenant's trial state against the current time.
 * `effectiveBillingStatus` is what the server should report to clients (after
 * the lazy flip): if the trial has expired in the DB but cron hasn't flipped
 * it yet, we return "inactive" here so the UI gate triggers immediately.
 */
export interface TrialEvaluation {
  effectiveBillingStatus: string;
  /** True when the trial flip should be persisted (caller decides whether to fire-and-forget the UPDATE). */
  shouldPersistFlip: boolean;
  /**
   * Whether the dashboard billing gate should fire. Despite the historical
   * name, this is the general "billing locked" signal: true for an expired
   * trial, a churned/cancelled paying customer, or any terminal inactive state.
   * It is false for complimentary grants (see {@link isCompedTenant}), which
   * stay open. Renaming the field is intentionally avoided — it is a published
   * contract across auth → RoleContext → layout and ~10 tests.
   */
  isTrialExpired: boolean;
}

/**
 * A complimentary / manual grant: the plan is `active` but no Stripe
 * subscription backs it and it is not a time-boxed trial. Matches the free
 * "MAX for a year" grants (billing.manualActivate / SVC- grant codes) which set
 * billing_status=active, current_period_end ≈ +1y and never create a Stripe
 * subscription. Such accounts must never be auto-locked by the dashboard gate.
 */
export function isCompedTenant(input: TenantBillingInput): boolean {
  return (
    (input.billingStatus ?? "trialing") === "active" &&
    !input.stripeSubscriptionId &&
    !input.trialEndsAt
  );
}

export function evaluateTrialState(
  input: TenantBillingInput,
  nowUnix: number,
): TrialEvaluation {
  const declared = input.billingStatus ?? "trialing";
  const trialExpiredInDb =
    declared === "trialing" && !!input.trialEndsAt && nowUnix > input.trialEndsAt;

  const effective = trialExpiredInDb ? "inactive" : declared;

  // Billing is "locked" once access has lapsed: an expired trial, a
  // churned/cancelled paying customer, or any terminal inactive state. The
  // previous rule (`inactive && !stripeCustomer`) left a churned paying
  // customer's dashboard open forever — that hole is now closed. The ONLY
  // exception is a complimentary grant, which is `active` and stays open;
  // the isCompedTenant guard is explicit defence in depth since comps never
  // reach the inactive/canceled branch anyway.
  const locked =
    (effective === "inactive" || effective === "canceled") && !isCompedTenant(input);

  return {
    effectiveBillingStatus: effective,
    shouldPersistFlip: trialExpiredInDb,
    isTrialExpired: locked,
  };
}

/**
 * Final UI decision: should the BillingGate component render instead of the
 * normal dashboard content?
 */
export function shouldShowBillingGate(args: {
  role: AppRole;
  isTrialExpired: boolean;
  pathname: string;
}): boolean {
  if (!isBillingGatedRole(args.role)) return false;
  if (!args.isTrialExpired) return false;
  if (isGateBypassPath(args.pathname)) return false;
  return true;
}
