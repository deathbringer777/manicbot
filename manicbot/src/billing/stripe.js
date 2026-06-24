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
  // Distinguish a genuine 404 (subscription truly gone in Stripe) from a
  // transient failure (5xx / 429 / network / timeout). The reconcile cron
  // CLEARS stripe_subscription_id when this returns null, so a transient error
  // must THROW — not return null — otherwise a momentary Stripe blip would
  // orphan a live subscription's id, drop the tenant out of the candidate set,
  // and make the divergence permanently invisible. The cron's per-row try/catch
  // swallows the throw and the row is retried on the next run.
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: authHeader(secretKey),
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  if (res.status === 404) return null; // genuinely gone → caller may clear the local id
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe getSubscription failed: ${res.status}`);
  }
  return data;
}

/**
 * List Stripe balance transactions (one page). The ledger sync mirrors these
 * into D1 — `balance_transactions` is the only Stripe object that carries `fee`
 * and `net` natively (invoices do not) and covers every money movement (charge,
 * refund, dispute, payout, adjustment, stripe_fee).
 *
 * Unlike `stripeRequest` (which swallows errors into `{ error }`), this THROWS
 * on a non-2xx / network failure so the caller can abort a sync run WITHOUT
 * advancing its high-water cursor.
 *
 * @param {string} secretKey
 * @param {{ limit?: number, createdGte?: number, startingAfter?: string }} [opts]
 * @returns {Promise<{ data: object[], has_more: boolean }>}
 */
export async function listBalanceTransactions(secretKey, opts = {}) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100), 1), 100);
  const params = new URLSearchParams({ limit: String(limit) });
  if (opts.createdGte != null) params.set('created[gte]', String(opts.createdGte));
  if (opts.startingAfter) params.set('starting_after', opts.startingAfter);

  const res = await fetch(`${STRIPE_API}/balance_transactions?${params.toString()}`, {
    method: 'GET',
    headers: authHeader(secretKey),
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe balance_transactions failed: ${res.status}`);
  }
  return { data: Array.isArray(data.data) ? data.data : [], has_more: !!data.has_more };
}

/**
 * STRIPE-COUPON-01 — Stripe coupons are IMMUTABLE: percent_off / duration /
 * duration_in_months cannot be edited after creation. ensureCoupon returns a
 * pre-existing coupon by id, so if the intended economics ever change (e.g. a
 * retention catalogue constant is edited) WITHOUT rotating the coupon id, we'd
 * silently keep applying the STALE discount. Fail loudly instead — the remedy
 * is to rotate the coupon id.
 *
 * @param {{percent_off?: number, duration?: string, duration_in_months?: number|null}} existing
 * @param {string} code
 * @param {number} percentOff
 * @param {{duration: 'once'|'repeating'|'forever', months?: number}} durationOpts
 * @throws {Error} when the live coupon's economics differ from intended.
 */
function assertCouponEconomics(existing, code, percentOff, durationOpts) {
  const wantMonths = durationOpts.duration === 'repeating' ? (durationOpts.months ?? null) : null;
  const gotMonths = existing?.duration_in_months ?? null;
  const mismatch =
    Number(existing?.percent_off) !== Number(percentOff) ||
    existing?.duration !== durationOpts.duration ||
    (durationOpts.duration === 'repeating' && gotMonths !== wantMonths);
  if (mismatch) {
    throw new Error(
      `Stripe coupon ${code} exists with mismatched economics ` +
      `(have percent_off=${existing?.percent_off} duration=${existing?.duration} months=${gotMonths}, ` +
      `want percent_off=${percentOff} duration=${durationOpts.duration} months=${wantMonths}); rotate the coupon id`,
    );
  }
}

/**
 * Idempotent Stripe Coupon mint. Used by the cancellation retention flow
 * to surface a discount counter-offer to the salon owner.
 *
 * Contract:
 *   1. GET /v1/coupons/{code} first. If 200, return the existing coupon.
 *   2. Else POST /v1/coupons with the supplied {id, percent_off, duration,
 *      duration_in_months?}. Stripe lets us choose our own id so a second
 *      call to this function with the same code becomes a single GET.
 *   3. If POST returns 400 because another process raced us and just
 *      created the coupon ("resource_already_exists" / "already exists"),
 *      re-GET and return that row. The user sees one coupon either way.
 *
 * @param {string} secretKey Stripe API secret.
 * @param {string} code Coupon id (we set this — e.g. "RETENTION_MONTHLY_50_3M").
 * @param {number} percentOff Discount percent (0-100).
 * @param {{duration: 'once'|'repeating'|'forever', months?: number}} durationOpts
 * @returns {Promise<{id: string, percent_off: number, duration: string, duration_in_months?: number}>}
 * @throws {Error} when Stripe returns a non-recoverable error (auth, network, etc.).
 */
export async function ensureCoupon(secretKey, code, percentOff, durationOpts) {
  // 1. Try to retrieve existing coupon first.
  const getRes = await fetch(`${STRIPE_API}/coupons/${encodeURIComponent(code)}`, {
    method: 'GET',
    headers: authHeader(secretKey),
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  if (getRes.ok) {
    const existing = await getRes.json();
    assertCouponEconomics(existing, code, percentOff, durationOpts);
    return existing;
  }
  if (getRes.status !== 404) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Stripe coupon GET failed: ${getRes.status}`);
  }

  // 2. Not found — try to create with our chosen id.
  const params = {
    id: code,
    percent_off: String(percentOff),
    duration: durationOpts.duration,
  };
  if (durationOpts.duration === 'repeating' && durationOpts.months != null) {
    params.duration_in_months = String(durationOpts.months);
  }
  const postRes = await fetch(`${STRIPE_API}/coupons`, {
    method: 'POST',
    headers: { ...authHeader(secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params),
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  if (postRes.ok) {
    return await postRes.json();
  }

  // 3. POST failed — if the error is a duplicate-id collision, re-GET.
  // Stripe's exact message for this case has changed over the years; match
  // both the modern `resource_already_exists` code and the textual
  // "already exists" fallback for older API versions.
  let postErrBody = {};
  try { postErrBody = await postRes.json(); } catch { /* tolerate empty body */ }
  const msg = postErrBody?.error?.message || '';
  const errCode = postErrBody?.error?.code || '';
  const isDuplicate =
    postRes.status === 400 &&
    (errCode === 'resource_already_exists' || /already exists/i.test(msg));
  if (isDuplicate) {
    const reGet = await fetch(`${STRIPE_API}/coupons/${encodeURIComponent(code)}`, {
      method: 'GET',
      headers: authHeader(secretKey),
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
    if (reGet.ok) {
      const existing = await reGet.json();
      assertCouponEconomics(existing, code, percentOff, durationOpts);
      return existing;
    }
    const err2 = await reGet.json().catch(() => ({}));
    throw new Error(err2?.error?.message || `Stripe coupon re-GET failed: ${reGet.status}`);
  }

  throw new Error(msg || `Stripe coupon POST failed: ${postRes.status}`);
}

/**
 * Apply a coupon to an existing subscription. Used after `ensureCoupon` —
 * the discount is applied for the coupon's `duration` (e.g. repeating/3
 * months from the next invoice).
 *
 * @param {string} secretKey
 * @param {string} subscriptionId
 * @param {string} couponCode
 * @returns {Promise<{id: string, discount?: object}>}
 */
export async function applyCouponToSubscription(secretKey, subscriptionId, couponCode) {
  const params = formBody({ coupon: couponCode });
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST',
    headers: { ...authHeader(secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe subscription update failed: ${res.status}`);
  }
  return data;
}

/**
 * Idempotent Stripe Promotion Code mint. A promotion_code is the customer-facing
 * redeemable string (e.g. WIOSNA20) that wraps a coupon (the economics). Used by
 * the seasonal-messaging promo module so a holiday template can render a real
 * code the owner enters at checkout (allow_promotion_codes is already true).
 *
 * Contract:
 *   1. GET /v1/promotion_codes?code=CODE first — Stripe enforces code uniqueness,
 *      so a re-mint with the same code returns the existing one (idempotent).
 *   2. Else POST /v1/promotion_codes {coupon, code, expires_at?, max_redemptions?}.
 *
 * @param {string} secretKey  Stripe API secret (TEST until go-live).
 * @param {object} opts
 * @param {string} opts.coupon          coupon id from ensureCoupon().
 * @param {string} opts.code            customer-facing code (uppercased by Stripe).
 * @param {number} [opts.expiresAt]     unix seconds; Stripe `expires_at`.
 * @param {number} [opts.maxRedemptions]
 * @returns {Promise<{id:string, code:string, coupon:object, livemode:boolean, expires_at?:number}>}
 */
export async function createPromotionCode(secretKey, opts) {
  const { coupon, code, expiresAt, maxRedemptions } = opts || {};
  if (!coupon || !code) throw new Error('createPromotionCode: coupon and code required');

  // 1. Reuse an existing code (Stripe codes are unique per account).
  const listRes = await fetch(
    `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(code)}&limit=1`,
    { method: 'GET', headers: authHeader(secretKey), signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS) },
  );
  if (listRes.ok) {
    const list = await listRes.json();
    if (Array.isArray(list.data) && list.data.length > 0) return list.data[0];
  }

  // 2. Create.
  const params = { coupon, code };
  if (expiresAt != null) params.expires_at = String(expiresAt);
  if (maxRedemptions != null) params.max_redemptions = String(maxRedemptions);
  const postRes = await fetch(`${STRIPE_API}/promotion_codes`, {
    method: 'POST',
    headers: { ...authHeader(secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody(params),
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  const data = await postRes.json();
  if (!postRes.ok) {
    throw new Error(data?.error?.message || `Stripe promotion_code POST failed: ${postRes.status}`);
  }
  return data;
}

/**
 * Flip a subscription to cancel at the end of the current billing period.
 * The subscription stays `active` until `current_period_end`; Stripe then
 * fires `customer.subscription.deleted` which the worker webhook handler
 * already maps to `billing_status = inactive`.
 *
 * @param {string} secretKey
 * @param {string} subscriptionId
 * @returns {Promise<{id: string, cancel_at_period_end: boolean, current_period_end: number}>}
 */
export async function cancelSubscriptionAtPeriodEnd(secretKey, subscriptionId) {
  const params = formBody({ cancel_at_period_end: 'true' });
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'POST',
    headers: { ...authHeader(secretKey), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe subscription cancel failed: ${res.status}`);
  }
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
