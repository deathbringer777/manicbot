/**
 * Edge-compatible Stripe API helpers.
 * No Stripe SDK — raw REST API via fetch.
 */

const STRIPE_API = "https://api.stripe.com/v1";

function encodeForm(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function stripePost<T>(secretKey: string, path: string, data: Record<string, string>): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeForm(data),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error((json as any).error?.message ?? `Stripe error: ${res.status}`);
  }
  return json;
}

async function stripeGet<T>(secretKey: string, path: string, params?: Record<string, string>): Promise<T> {
  let url = `${STRIPE_API}${path}`;
  if (params) url += "?" + encodeForm(params);
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json() as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error((json as any).error?.message ?? `Stripe error: ${res.status}`);
  }
  return json;
}

interface StripeCustomer {
  id: string;
  email: string | null;
}

export async function getOrCreateCustomer(
  secretKey: string,
  opts: { tenantId: string; name: string; email?: string },
): Promise<string> {
  // Search for existing customer by metadata
  const search = await stripeGet<{ data: StripeCustomer[] }>(
    secretKey,
    "/customers/search",
    { query: `metadata["tenantId"]:"${opts.tenantId}"` },
  );
  if (search.data.length > 0) return search.data[0]!.id;

  // Create new customer
  const data: Record<string, string> = {
    name: opts.name,
    "metadata[tenantId]": opts.tenantId,
    "metadata[platform]": "manicbot",
  };
  if (opts.email) data.email = opts.email;

  const customer = await stripePost<{ id: string }>(secretKey, "/customers", data);
  return customer.id;
}

/** Map our app lang codes to Stripe's supported locale strings. */
function toStripeLocale(lang?: string): string {
  const map: Record<string, string> = { ru: "ru", ua: "uk", en: "en", pl: "pl" };
  return map[lang ?? ""] ?? "auto";
}

/**
 * Create a one-shot percent-off Stripe Coupon. Used by the referral program
 * to mint a fresh, single-use coupon per checkout (cleaner than reusing
 * a long-lived promo code — Stripe charges for redemption history).
 */
export async function createOneTimePercentOffCoupon(
  secretKey: string,
  opts: { percentOff: number; name: string; metadata?: Record<string, string> },
): Promise<string> {
  const data: Record<string, string> = {
    percent_off: String(opts.percentOff),
    duration: "once",
    name: opts.name,
  };
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      data[`metadata[${k}]`] = v;
    }
  }
  const coupon = await stripePost<{ id: string }>(secretKey, "/coupons", data);
  return coupon.id;
}

export async function createCheckoutSession(
  secretKey: string,
  opts: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    tenantId: string;
    plan: string;
    locale?: string;
    billingCycle?: "monthly" | "annual";
    couponId?: string;          // referral discount, applied once on this checkout
    referralId?: string;        // stamped into subscription metadata for webhook routing
  },
): Promise<string> {
  const cycle = opts.billingCycle ?? "monthly";
  const data: Record<string, string> = {
    customer: opts.customerId,
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    // Session metadata — available in checkout.session.completed
    "metadata[tenantId]": opts.tenantId,
    "metadata[plan]": opts.plan,
    "metadata[billingCycle]": cycle,
    // Subscription metadata — available in subscription.updated / invoice.paid
    "subscription_data[metadata][tenantId]": opts.tenantId,
    "subscription_data[metadata][plan]": opts.plan,
    "subscription_data[metadata][billingCycle]": cycle,
    locale: toStripeLocale(opts.locale),
  };
  if (opts.couponId) {
    data["discounts[0][coupon]"] = opts.couponId;
  }
  if (opts.referralId) {
    data["metadata[referralId]"] = opts.referralId;
    data["subscription_data[metadata][referralId]"] = opts.referralId;
  }
  const session = await stripePost<{ url: string }>(secretKey, "/checkout/sessions", data);
  return session.url;
}

export async function createEmbeddedCheckoutSession(
  secretKey: string,
  opts: {
    customerId: string;
    priceId: string;
    returnUrl: string;
    tenantId: string;
    plan: string;
    locale?: string;
    billingCycle?: "monthly" | "annual";
    couponId?: string;
    referralId?: string;
  },
): Promise<string> {
  const cycle = opts.billingCycle ?? "monthly";
  const data: Record<string, string> = {
    customer: opts.customerId,
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    ui_mode: "embedded",
    return_url: opts.returnUrl,
    "metadata[tenantId]": opts.tenantId,
    "metadata[plan]": opts.plan,
    "metadata[billingCycle]": cycle,
    "subscription_data[metadata][tenantId]": opts.tenantId,
    "subscription_data[metadata][plan]": opts.plan,
    "subscription_data[metadata][billingCycle]": cycle,
    locale: toStripeLocale(opts.locale),
  };
  if (opts.couponId) {
    data["discounts[0][coupon]"] = opts.couponId;
  }
  if (opts.referralId) {
    data["metadata[referralId]"] = opts.referralId;
    data["subscription_data[metadata][referralId]"] = opts.referralId;
  }
  const session = await stripePost<{ client_secret: string }>(secretKey, "/checkout/sessions", data);
  return session.client_secret;
}

export async function createBillingPortalSession(
  secretKey: string,
  opts: { customerId: string; returnUrl: string },
): Promise<string> {
  const session = await stripePost<{ url: string }>(secretKey, "/billing_portal/sessions", {
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
  return session.url;
}

/** Stripe Subscription shape we care about for the retention flow. */
export interface StripeSubscription {
  id: string;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: {
    data?: Array<{
      plan?: { interval?: "month" | "year"; interval_count?: number };
      price?: { recurring?: { interval?: "month" | "year" } };
    }>;
  };
}

export async function retrieveSubscription(
  secretKey: string,
  subscriptionId: string,
): Promise<StripeSubscription | null> {
  const res = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  const json = await res.json() as StripeSubscription & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error((json as any).error?.message ?? `Stripe error: ${res.status}`);
  }
  return json;
}

/**
 * Idempotent Stripe Coupon mint. Mirror of Worker `manicbot/src/billing/stripe.js`
 * `ensureCoupon` — kept in lockstep so backend logic stays single-source-of-truth.
 *
 * 1. GET /v1/coupons/{code}; return existing on 200.
 * 2. Else POST /v1/coupons; create with our chosen id.
 * 3. If POST 400-conflicts, re-GET (race-condition guard).
 */
export async function ensureCoupon(
  secretKey: string,
  code: string,
  percentOff: number,
  durationOpts: { duration: "once" | "repeating" | "forever"; months?: number },
): Promise<{ id: string; percent_off: number; duration: string; duration_in_months?: number | null }> {
  const getUrl = `${STRIPE_API}/coupons/${encodeURIComponent(code)}`;
  const headers = { Authorization: `Bearer ${secretKey}` };

  const getRes = await fetch(getUrl, { headers, signal: AbortSignal.timeout(15_000) });
  if (getRes.ok) return await getRes.json();
  if (getRes.status !== 404) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error((err as any)?.error?.message ?? `Stripe coupon GET failed: ${getRes.status}`);
  }

  const params: Record<string, string> = {
    id: code,
    percent_off: String(percentOff),
    duration: durationOpts.duration,
  };
  if (durationOpts.duration === "repeating" && durationOpts.months != null) {
    params.duration_in_months = String(durationOpts.months);
  }
  const postRes = await fetch(`${STRIPE_API}/coupons`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: encodeForm(params),
    signal: AbortSignal.timeout(15_000),
  });
  if (postRes.ok) return await postRes.json();

  let postErr: any = {};
  try { postErr = await postRes.json(); } catch { /* tolerate empty */ }
  const errCode = postErr?.error?.code ?? "";
  const errMsg = postErr?.error?.message ?? "";
  const isDuplicate =
    postRes.status === 400 &&
    (errCode === "resource_already_exists" || /already exists/i.test(errMsg));
  if (isDuplicate) {
    const reGet = await fetch(getUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (reGet.ok) return await reGet.json();
    const e = await reGet.json().catch(() => ({}));
    throw new Error((e as any)?.error?.message ?? `Stripe coupon re-GET failed: ${reGet.status}`);
  }
  throw new Error(errMsg || `Stripe coupon POST failed: ${postRes.status}`);
}

/** Apply an existing coupon to a subscription. */
export async function applyCouponToSubscription(
  secretKey: string,
  subscriptionId: string,
  couponCode: string,
): Promise<{ id: string }> {
  return await stripePost(secretKey, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    coupon: couponCode,
  });
}

/**
 * Flip a subscription to cancel at the end of the current billing period.
 * The subscription stays `active` until `current_period_end`; Stripe then
 * fires `customer.subscription.deleted` which the Worker webhook handler
 * already maps to `billing_status = inactive`.
 */
export async function cancelSubscriptionAtPeriodEnd(
  secretKey: string,
  subscriptionId: string,
): Promise<{ id: string; cancel_at_period_end: boolean; current_period_end: number }> {
  return await stripePost(secretKey, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: "true",
  });
}
