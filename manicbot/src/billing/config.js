/**
 * Stripe billing configuration. All values from env — no hardcoded secrets.
 */

export const PLANS = {
  START: 'start',
  PRO: 'pro',
  MAX: 'max',
};

export const BILLING_STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  GRACE_PERIOD: 'grace_period',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  CANCELED: 'canceled',
  PAUSED: 'paused',
  INCOMPLETE: 'incomplete',
  INACTIVE: 'inactive',
};

export const PLAN_LIMITS = {
  start:  { masters: 1,        ai: false, support: false, calendar: false, whiteLabel: false, channels: ['telegram'],                             wa_templates_monthly: 0    },
  pro:    { masters: 5,        ai: true,  support: true,  calendar: true,  whiteLabel: false, channels: ['telegram', 'whatsapp', 'instagram'],    wa_templates_monthly: 500  },
  max:    { masters: Infinity, ai: true,  support: true,  calendar: true,  whiteLabel: true,  channels: ['telegram', 'whatsapp', 'instagram'],    wa_templates_monthly: 5000 },
};

export const TRIAL_DURATION_MS = 14 * 24 * 3600 * 1000;  // 14 дней
export const GRACE_DURATION_MS  = 7 * 24 * 3600 * 1000;  // 7 дней

/**
 * @param {object} env - Worker env (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_*_MONTHLY, APP_BASE_URL)
 * @returns {{ ok: boolean, secretKey?: string, webhookSecret?: string, priceIds?: object, baseUrl?: string, error?: string }}
 */
export function getStripeConfig(env) {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const baseUrl = (env.APP_BASE_URL || '').replace(/\/$/, '');

  if (!secretKey || typeof secretKey !== 'string') {
    return { ok: false, error: 'STRIPE_SECRET_KEY not set' };
  }
  if (!webhookSecret || typeof webhookSecret !== 'string') {
    return { ok: false, error: 'STRIPE_WEBHOOK_SECRET not set' };
  }

  const priceIds = {
    [PLANS.START]: env.STRIPE_PRICE_START_MONTHLY || null,
    [PLANS.PRO]: env.STRIPE_PRICE_PRO_MONTHLY || null,
    [PLANS.MAX]: env.STRIPE_PRICE_MAX_MONTHLY || null,
  };
  // Sprint 4: annual billing (20% discount reflected in the Stripe Price itself).
  // Set STRIPE_PRICE_*_ANNUAL via `wrangler secret put` to enable the toggle
  // on landing + admin-app checkout. If unset, monthly is the only option.
  const priceIdsAnnual = {
    [PLANS.START]: env.STRIPE_PRICE_START_ANNUAL || null,
    [PLANS.PRO]: env.STRIPE_PRICE_PRO_ANNUAL || null,
    [PLANS.MAX]: env.STRIPE_PRICE_MAX_ANNUAL || null,
  };

  return {
    ok: true,
    secretKey,
    webhookSecret,
    priceIds,
    priceIdsAnnual,
    baseUrl: baseUrl || undefined,
  };
}

/**
 * Resolve the price ID for a plan + billing cycle.
 * @param {{ priceIds: object, priceIdsAnnual: object }} cfg
 * @param {'start'|'pro'|'max'} plan
 * @param {'monthly'|'annual'} [cycle='monthly']
 * @returns {string|null}
 */
export function resolvePriceId(cfg, plan, cycle = 'monthly') {
  if (cycle === 'annual') return cfg?.priceIdsAnnual?.[plan] || cfg?.priceIds?.[plan] || null;
  return cfg?.priceIds?.[plan] || null;
}

