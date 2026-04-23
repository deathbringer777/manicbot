/**
 * Stripe API service (fetch-based, no SDK). Used for customers, checkout, portal.
 */

import { getStripeConfig, PLANS, resolvePriceId } from './config.js';
import { log } from '../utils/logger.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const STRIPE_TIMEOUT_MS = 8000;

// Sprint 2: Pin Stripe-Version so API upgrades don't silently change response
// shapes (e.g. new fields, relocated errors). Update this with intent — not
// whenever Stripe releases a new version.
const STRIPE_API_VERSION = '2024-06-20';

function authHeader(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
}

function formBody(obj) {
  return new URLSearchParams(obj).toString();
}

async function stripeRequest(url, opts) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS) });
    const data = await res.json();
    return data;
  } catch (e) {
    log.error('billing.stripe', e instanceof Error ? e : new Error(String(e.message)), { url });
    return { error: { message: e.message || 'Network error' } };
  }
}

/**
 * Create or get Stripe customer for tenant.
 * @param {string} secretKey
 * @param {object} opts - { email?, name?, metadata: { tenantId } }
 * @returns {{ id: string } | { error: string }}
 */
export async function createStripeCustomer(secretKey, opts = {}) {
  const params = {
    metadata: { tenantId: opts.tenantId || '' },
  };
  if (opts.email) params.email = opts.email;
  if (opts.name) params.name = opts.name;

  const data = await stripeRequest(`${STRIPE_API}/customers`, {
    method: 'POST',
    headers: { ...authHeader(secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params),
  });
  if (data.error) return { error: data.error.message || 'Stripe customer create failed' };
  return { id: data.id };
}

/**
 * Create Checkout Session for subscription (monthly or annual).
 * @param {object} env - Worker env
 * @param {object} opts - { tenantId, customerId?, customer_email?, plan, billingCycle?, successUrl, cancelUrl, allowPromotionCodes? }
 * @returns {{ url?: string, sessionId?: string, error?: string }}
 */
export async function createCheckoutSession(env, opts) {
  const cfg = getStripeConfig(env);
  if (!cfg.ok) return { error: cfg.error };
  const cycle = opts.billingCycle === 'annual' ? 'annual' : 'monthly';
  const priceId = resolvePriceId(cfg, opts.plan, cycle);
  if (!priceId) return { error: `Plan ${opts.plan} (${cycle}) has no Stripe price configured` };
  const successUrl = opts.successUrl || `${cfg.baseUrl}/stripe/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = opts.cancelUrl || (cfg.baseUrl ? `${cfg.baseUrl}/` : 'https://example.com');

  const params = {
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'client_reference_id': opts.tenantId || '',
    'metadata[tenantId]': opts.tenantId || '',
    'metadata[billingCycle]': cycle,
    'metadata[plan]': opts.plan || '',
    'subscription_data[metadata][tenantId]': opts.tenantId || '',
    'subscription_data[metadata][plan]': opts.plan || '',
    'subscription_data[metadata][billingCycle]': cycle,
    // Enable Stripe-hosted promotion code redemption.
    'allow_promotion_codes': opts.allowPromotionCodes === false ? 'false' : 'true',
  };
  if (opts.customerId) {
    params.customer = opts.customerId;
  } else if (opts.customer_email) {
    params['customer_email'] = opts.customer_email;
  }

  const data = await stripeRequest(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: { ...authHeader(cfg.secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params),
  });
  if (data.error) return { error: data.error.message || 'Checkout session create failed' };
  return { url: data.url, sessionId: data.id };
}

/**
 * Create Customer Portal session.
 * @param {object} env - Worker env
 * @param {object} opts - { customerId, returnUrl }
 * @returns {{ url?: string, error?: string }}
 */
export async function createPortalSession(env, opts) {
  const cfg = getStripeConfig(env);
  if (!cfg.ok) return { error: cfg.error };
  if (!opts.customerId) return { error: 'customerId required for portal' };
  const returnUrl = opts.returnUrl || cfg.baseUrl || 'https://example.com';

  const params = {
    customer: opts.customerId,
    return_url: returnUrl,
  };

  const data = await stripeRequest(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: { ...authHeader(cfg.secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params),
  });
  if (data.error) return { error: data.error.message || 'Portal session create failed' };
  return { url: data.url };
}

/**
 * Retrieve subscription from Stripe (for reconciliation).
 * @param {string} secretKey
 * @param {string} subscriptionId
 */
export async function getSubscription(secretKey, subscriptionId) {
  const data = await stripeRequest(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
    headers: authHeader(secretKey),
  });
  if (data.error) return null;
  return data;
}

/**
 * Map Stripe subscription status to internal BILLING_STATUS.
 */
export function mapStripeStatusToBilling(stripeStatus) {
  const map = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    unpaid: 'unpaid',
    canceled: 'canceled',
    paused: 'paused',
    incomplete: 'incomplete',
    incomplete_expired: 'inactive',
  };
  return map[stripeStatus] || 'inactive';
}

export { PLANS };
