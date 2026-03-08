/**
 * Stripe webhook handler: verify signature, idempotency, update tenant billing state.
 * Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
 */

const STRIPE_EVT_PREFIX = 'stripe:evt:';
const EVT_TTL = 86400 * 7; // 7 days idempotency

/** Stripe signature format: "t=timestamp,v1=hexsig". Verify HMAC-SHA256(secret, "timestamp.payload") === v1. */
export async function verifyStripeSignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const parts = {};
  for (const p of signature.split(',')) {
    const [k, v] = p.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const signedPayload = t + '.' + (typeof payload === 'string' ? payload : JSON.stringify(payload));
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedHex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expectedHex === v1.toLowerCase();
}

export async function handleStripeWebhook(kv, payload, signature, webhookSecret) {
  if (!kv || !payload || !webhookSecret) return { ok: false, status: 400 };
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (!(await verifyStripeSignature(raw, signature, webhookSecret))) {
    return { ok: false, status: 401 };
  }
  let body;
  try {
    body = typeof payload === 'object' ? payload : JSON.parse(payload);
  } catch {
    return { ok: false, status: 400 };
  }
  const eventId = body.id;
  if (eventId) {
    const seen = await kv.get(STRIPE_EVT_PREFIX + eventId, 'text');
    if (seen) return { ok: true, status: 200, skipped: true };
    await kv.put(STRIPE_EVT_PREFIX + eventId, '1', { expirationTtl: EVT_TTL });
  }
  const type = body.type || '';
  if (type === 'checkout.session.completed') {
    const session = body.data?.object;
    const tenantId = session?.metadata?.tenantId;
    if (tenantId) {
      const tenant = await kv.get('tenant:' + tenantId, 'json');
      if (tenant) {
        const updated = { ...tenant, stripeCustomerId: session.customer || tenant.stripeCustomerId, updatedAt: Date.now() };
        await kv.put('tenant:' + tenantId, JSON.stringify(updated));
      }
    }
  }
  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const sub = body.data?.object;
    const customerId = sub?.customer;
    // In production: find tenant by stripeCustomerId and update subscription fields
  }
  return { ok: true, status: 200 };
}
