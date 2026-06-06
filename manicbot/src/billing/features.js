/**
 * Feature gating based on tenant billing status and plan.
 * All checks are safe to call in legacy mode (no ctx.tenant) — returns true.
 */

import { PLAN_LIMITS } from './config.js';
import { nowSec } from '../utils/time.js';

// Features and which plan field they require (null = available on all plans)
const FEATURE_PLAN_FIELD = {
  booking:        null,
  ai:             'ai',
  support_tickets:'support',
  calendar:       'calendar',
  masters_add:    null,
  white_label:    'whiteLabel',
  // Owning more than one salon (home + secondaries) — MAX plan only.
  multi_salon:    'multiSalon',
  // Channel features: checked via the `channels` array in PLAN_LIMITS
  whatsapp:       '_channel_whatsapp',
  instagram:      '_channel_instagram',
};

/**
 * Check if a feature is available for the current tenant.
 * @param {object} ctx - tenant context
 * @param {string} feature - one of booking|ai|support_tickets|calendar|masters_add|white_label
 * @returns {boolean}
 */
export function canUse(ctx, feature) {
  // Legacy mode (single-bot, no tenant) — no restrictions
  if (!ctx.tenant) return true;

  const status = ctx.tenant.billingStatus || 'inactive';
  const plan   = ctx.tenant.plan || 'start';

  // Completely blocked statuses
  if (status === 'inactive' || status === 'canceled') return false;

  // Payment-trouble statuses — booking-only, no premium features.
  //
  // #S2-4 — grace_period, past_due and unpaid all mean "the card has not
  // cleared". Previously past_due/unpaid fell through to the active/trialing
  // branch below and granted FULL plan access, so a tenant's entitlement
  // depended purely on WHICH webhook landed: invoice.payment_failed sets
  // grace_period (booking-only) while a bare customer.subscription.updated
  // maps the Stripe status to past_due (was full access). Treat them
  // identically. graceEndsAt only gates grace_period — past_due/unpaid have
  // no local expiry clock (Stripe drives their lifecycle), so they stay
  // booking-only until a paid invoice or cancellation moves them.
  if (status === 'grace_period' || status === 'past_due' || status === 'unpaid') {
    if (status === 'grace_period' && ctx.tenant.graceEndsAt && nowSec() > ctx.tenant.graceEndsAt) return false;
    return feature === 'booking';
  }

  // #B-1 — entitlement is an ALLOWLIST. Only `active`/`trialing` reach the plan
  // checks below. Any other status — incomplete, incomplete_expired, paused, or
  // an unmapped/typo value — is NOT a paid subscription and must be denied,
  // rather than falling through to full plan access (the previous behaviour).
  if (status !== 'active' && status !== 'trialing') return false;

  // trialing or active — check plan limits
  const planField = FEATURE_PLAN_FIELD[feature];
  if (planField === undefined) return false; // unknown feature
  if (planField === null) return true;       // no plan restriction

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.start;

  // Channel features: check the `channels` array
  if (planField === '_channel_whatsapp') return (limits.channels ?? ['telegram']).includes('whatsapp');
  if (planField === '_channel_instagram') return (limits.channels ?? ['telegram']).includes('instagram');

  return limits[planField] === true;
}

// Re-export template helpers for convenience
export { canSendTemplate, getTemplateUsageThisMonth } from '../channels/whatsapp-templates.js';

/**
 * Maximum number of masters allowed for the current tenant's plan.
 */
export function getMastersLimit(ctx) {
  if (!ctx.tenant) return Infinity; // legacy mode
  const plan = ctx.tenant.plan || 'start';
  return (PLAN_LIMITS[plan] || PLAN_LIMITS.start).masters;
}

/** Returns true if tenant access is fully blocked (inactive or canceled). */
export function isInactive(ctx) {
  if (!ctx.tenant) return false;
  const s = ctx.tenant.billingStatus;
  return s === 'inactive' || s === 'canceled';
}

/** Returns true if tenant is in the 7-day grace period after payment failure. */
export function isGracePeriod(ctx) {
  if (!ctx.tenant) return false;
  return ctx.tenant.billingStatus === 'grace_period';
}

/** Returns true if tenant is in trial period. */
export function isTrialing(ctx) {
  if (!ctx.tenant) return false;
  return ctx.tenant.billingStatus === 'trialing';
}

/**
 * Returns remaining grace days (0 if expired or not in grace period).
 */
export function graceRemainingDays(ctx) {
  if (!isGracePeriod(ctx) || !ctx.tenant.graceEndsAt) return 0;
  return Math.max(0, Math.ceil((ctx.tenant.graceEndsAt - nowSec()) / 86400));
}

/**
 * Returns remaining trial days (0 if expired or not trialing).
 */
export function trialRemainingDays(ctx) {
  if (!isTrialing(ctx) || !ctx.tenant.trialEndsAt) return 0;
  return Math.max(0, Math.ceil((ctx.tenant.trialEndsAt - nowSec()) / 86400));
}
