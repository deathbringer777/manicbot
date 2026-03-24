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

  // Grace period — only core booking works; no AI, support, calendar
  if (status === 'grace_period') {
    return feature === 'booking';
  }

  // trialing or active — check plan limits
  const planField = FEATURE_PLAN_FIELD[feature];
  if (planField === undefined) return false; // unknown feature
  if (planField === null) return true;       // no plan restriction

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.start;
  return limits[planField] === true;
}

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
