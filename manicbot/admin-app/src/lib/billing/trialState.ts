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
 * /billing: the only place a user can resolve the gate (start a subscription).
 * /settings: account-level escape hatch (password change, email change, logout).
 * /plugins, /plugin/*: allow unsubscribing from paid plugin add-ons without paying first.
 */
const GATE_BYPASS_PREFIXES = ["/billing", "/settings", "/plugins", "/plugin/"] as const;

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
  /** Matches BillingSection.tsx:247 — "trial expired AND no Stripe customer ever". */
  isTrialExpired: boolean;
}

export function evaluateTrialState(
  input: TenantBillingInput,
  nowUnix: number,
): TrialEvaluation {
  const declared = input.billingStatus ?? "trialing";
  const trialExpiredInDb =
    declared === "trialing" && !!input.trialEndsAt && nowUnix > input.trialEndsAt;

  const effective = trialExpiredInDb ? "inactive" : declared;
  const hasStripeCustomer = !!input.stripeCustomerId;

  return {
    effectiveBillingStatus: effective,
    shouldPersistFlip: trialExpiredInDb,
    isTrialExpired: effective === "inactive" && !hasStripeCustomer,
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
