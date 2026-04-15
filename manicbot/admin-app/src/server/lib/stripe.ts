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

export async function createCheckoutSession(
  secretKey: string,
  opts: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    tenantId: string;
    locale?: string;
  },
): Promise<string> {
  const session = await stripePost<{ url: string }>(secretKey, "/checkout/sessions", {
    customer: opts.customerId,
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "subscription_data[metadata][tenantId]": opts.tenantId,
    locale: toStripeLocale(opts.locale),
  });
  return session.url;
}

export async function createEmbeddedCheckoutSession(
  secretKey: string,
  opts: {
    customerId: string;
    priceId: string;
    returnUrl: string;
    tenantId: string;
    locale?: string;
  },
): Promise<string> {
  const session = await stripePost<{ client_secret: string }>(secretKey, "/checkout/sessions", {
    customer: opts.customerId,
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": "1",
    mode: "subscription",
    ui_mode: "embedded",
    return_url: opts.returnUrl,
    "subscription_data[metadata][tenantId]": opts.tenantId,
    locale: toStripeLocale(opts.locale),
  });
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
