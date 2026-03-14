/**
 * Stripe billing configuration. All values from env — no hardcoded secrets.
 */

export const PLANS = {
  START: 'start',
  PRO: 'pro',
  STUDIO: 'studio',
};

export const BILLING_STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  CANCELED: 'canceled',
  PAUSED: 'paused',
  INCOMPLETE: 'incomplete',
  INACTIVE: 'inactive',
};

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
    [PLANS.STUDIO]: env.STRIPE_PRICE_STUDIO_MONTHLY || null,
  };

  return {
    ok: true,
    secretKey,
    webhookSecret,
    priceIds,
    baseUrl: baseUrl || undefined,
  };
}

/**
 * Check if Stripe is configured enough for checkout (need at least one price and baseUrl for success_url).
 */
export function isStripeReadyForCheckout(env) {
  const c = getStripeConfig(env);
  if (!c.ok) return false;
  const hasPrice = Object.values(c.priceIds || {}).some(Boolean);
  return hasPrice && !!c.baseUrl;
}
