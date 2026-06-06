/**
 * Edge-compatible Stripe API helpers.
 * No Stripe SDK — raw REST API via fetch.
 */

const STRIPE_API = "https://api.stripe.com/v1";

// #S2-6 — pin the Stripe API version on EVERY admin-app request, in lockstep
// with the Worker (`manicbot/src/billing/stripe.js` STRIPE_API_VERSION). An
// unpinned key floats on whatever default version the dashboard advertises, so
// a server-side version bump could silently relocate fields we read at the
// response root (e.g. `current_period_end` moved into `items[]` in 2025-04-01).
// Bump this with intent, in both files together — never implicitly.
const STRIPE_API_VERSION = "2024-06-20";

/** Auth + pinned-version headers shared by every Stripe call. */
function stripeAuthHeaders(secretKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${secretKey}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
}

function encodeForm(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function stripePost<T>(secretKey: string, path: string, data: Record<string, string>): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      ...stripeAuthHeaders(secretKey),
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
    headers: stripeAuthHeaders(secretKey),
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
    headers: stripeAuthHeaders(secretKey),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  const json = await res.json() as StripeSubscription & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error((json as any).error?.message ?? `Stripe error: ${res.status}`);
  }
  return json;
}

// ─── God Mode Billing dashboard — live financial reads ──────────────────────
// Power the real-money widgets (balance, payouts, recent charges, disputes).
// The historical revenue chart reads the D1 `stripe_ledger` mirror instead;
// these surface "right now" state that only Stripe holds. `stripeGet` throws on
// a non-2xx response, which the caller isolates per-section via allSettled.
// All amounts are Stripe minor units (PLN grosze); currency is lowercase ISO.

export interface StripeMoney {
  amount: number;
  currency: string;
}

export interface StripeBalanceResult {
  available: StripeMoney[];
  pending: StripeMoney[];
}

/** GET /v1/balance — current available + pending funds, per currency. */
export async function getBalance(secretKey: string): Promise<StripeBalanceResult> {
  const data = await stripeGet<{ available?: StripeMoney[]; pending?: StripeMoney[] }>(secretKey, "/balance");
  const pick = (arr?: StripeMoney[]): StripeMoney[] =>
    Array.isArray(arr) ? arr.map((b) => ({ amount: b.amount ?? 0, currency: b.currency ?? "" })) : [];
  return { available: pick(data.available), pending: pick(data.pending) };
}

/** Stripe caps list `limit` at 100; floor at 1. */
function clampLimit(limit: number | undefined, fallback: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? fallback), 1), 100);
}

interface RawCharge {
  id: string;
  amount?: number;
  currency?: string;
  created?: number;
  status?: string;
  paid?: boolean;
  refunded?: boolean;
  amount_refunded?: number;
  description?: string | null;
  billing_details?: { email?: string | null };
  receipt_email?: string | null;
}

export interface StripeChargeRow {
  id: string;
  amount: number;
  currency: string;
  created: number;
  status: string;
  paid: boolean;
  refunded: boolean;
  amountRefunded: number;
  description: string | null;
  email: string | null;
}

/** GET /v1/charges — most recent real payments (one bounded page). */
export async function listRecentCharges(
  secretKey: string,
  opts: { limit?: number } = {},
): Promise<{ data: StripeChargeRow[]; hasMore: boolean }> {
  const res = await stripeGet<{ data?: RawCharge[]; has_more?: boolean }>(secretKey, "/charges", {
    limit: String(clampLimit(opts.limit, 10)),
  });
  const data = (res.data ?? []).map((o) => ({
    id: String(o.id),
    amount: o.amount ?? 0,
    currency: o.currency ?? "",
    created: o.created ?? 0,
    status: o.status ?? "",
    paid: !!o.paid,
    refunded: !!o.refunded,
    amountRefunded: o.amount_refunded ?? 0,
    description: o.description ?? null,
    email: o.billing_details?.email ?? o.receipt_email ?? null,
  }));
  return { data, hasMore: !!res.has_more };
}

interface RawInvoice {
  id: string;
  number?: string | null;
  created?: number;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  status?: string;
  paid?: boolean;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
}

/** One row of a tenant's own billing history, shaped for the Billing UI. */
export interface StripeInvoiceRow {
  id: string;
  number: string | null;
  created: number;
  /** Minor units (e.g. grosze). amount_paid when settled, else amount_due. */
  amount: number;
  currency: string;
  /** draft | open | paid | void | uncollectible */
  status: string;
  paid: boolean;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

/**
 * Pure mapper: raw Stripe invoice → UI row. Exported for unit testing the
 * amount-selection + status normalisation without a network round-trip.
 */
export function mapStripeInvoiceRow(o: RawInvoice): StripeInvoiceRow {
  const paid = o.status === "paid" || !!o.paid;
  return {
    id: String(o.id),
    number: o.number ?? null,
    created: o.created ?? 0,
    amount: paid ? (o.amount_paid ?? 0) : (o.amount_due ?? 0),
    currency: (o.currency ?? "").toUpperCase(),
    status: o.status ?? "",
    paid,
    hostedUrl: o.hosted_invoice_url ?? null,
    pdfUrl: o.invoice_pdf ?? null,
  };
}

/** GET /v1/invoices?customer=… — a tenant's own recent invoices (one page). */
export async function listInvoices(
  secretKey: string,
  opts: { customerId: string; limit?: number },
): Promise<{ data: StripeInvoiceRow[]; hasMore: boolean }> {
  const res = await stripeGet<{ data?: RawInvoice[]; has_more?: boolean }>(secretKey, "/invoices", {
    customer: opts.customerId,
    limit: String(clampLimit(opts.limit, 12)),
  });
  const data = (res.data ?? []).map(mapStripeInvoiceRow);
  return { data, hasMore: !!res.has_more };
}

interface RawPayout {
  id: string;
  amount?: number;
  currency?: string;
  arrival_date?: number;
  status?: string;
  created?: number;
}

export interface StripePayoutRow {
  id: string;
  amount: number;
  currency: string;
  arrivalDate: number;
  status: string;
  created: number;
}

/** GET /v1/payouts — bank payouts (did the money actually land). */
export async function listPayouts(
  secretKey: string,
  opts: { limit?: number } = {},
): Promise<{ data: StripePayoutRow[]; hasMore: boolean }> {
  const res = await stripeGet<{ data?: RawPayout[]; has_more?: boolean }>(secretKey, "/payouts", {
    limit: String(clampLimit(opts.limit, 10)),
  });
  const data = (res.data ?? []).map((o) => ({
    id: String(o.id),
    amount: o.amount ?? 0,
    currency: o.currency ?? "",
    arrivalDate: o.arrival_date ?? 0,
    status: o.status ?? "",
    created: o.created ?? 0,
  }));
  return { data, hasMore: !!res.has_more };
}

interface RawDispute {
  id: string;
  amount?: number;
  currency?: string;
  reason?: string;
  status?: string;
  created?: number;
  evidence_details?: { due_by?: number | null };
}

export interface StripeDisputeRow {
  id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  created: number;
  dueBy: number | null;
}

/** GET /v1/disputes — chargebacks (deadline-sensitive, low volume). */
export async function listDisputes(
  secretKey: string,
  opts: { limit?: number } = {},
): Promise<{ data: StripeDisputeRow[]; hasMore: boolean }> {
  const res = await stripeGet<{ data?: RawDispute[]; has_more?: boolean }>(secretKey, "/disputes", {
    limit: String(clampLimit(opts.limit, 10)),
  });
  const data = (res.data ?? []).map((o) => ({
    id: String(o.id),
    amount: o.amount ?? 0,
    currency: o.currency ?? "",
    reason: o.reason ?? "",
    status: o.status ?? "",
    created: o.created ?? 0,
    dueBy: o.evidence_details?.due_by ?? null,
  }));
  return { data, hasMore: !!res.has_more };
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
  const headers = stripeAuthHeaders(secretKey);

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
