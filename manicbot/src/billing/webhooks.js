/**
 * Stripe webhook handler: verify signature, idempotency, update tenant billing state.
 * Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed.
 */

import { updateTenantBilling } from './storage.js';
import { mapStripeStatusToBilling } from './stripe.js';
import { GRACE_DURATION_MS } from './config.js';

const STRIPE_EVT_PREFIX = 'stripe:evt:';
const STRIPE_CUSTOMER_PREFIX = 'stripe_customer:';
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

async function resolveTenantIdByCustomer(kv, customerId) {
  if (!customerId) return null;
  const tenantId = await kv.get(STRIPE_CUSTOMER_PREFIX + customerId, 'text');
  return tenantId || null;
}

function subscriptionToBillingUpdates(sub) {
  const status = mapStripeStatusToBilling(sub.status);
  const periodEnd = sub.current_period_end ? sub.current_period_end * 1000 : null;
  const priceId = sub.items?.data?.[0]?.price?.id || null;
  return {
    billingStatus: status,
    subscriptionStatus: sub.status,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    currentPeriodEnd: periodEnd,
    nextPaymentDate: periodEnd,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    updatedAt: Date.now(),
  };
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
    const customerId = session?.customer;
    if (tenantId) {
      const tenant = await kv.get('tenant:' + tenantId, 'json');
      if (tenant) {
        const updates = {
          stripeCustomerId: customerId || tenant.stripeCustomerId,
          updatedAt: Date.now(),
        };
        if (session.subscription) {
          updates.stripeSubscriptionId = session.subscription;
          updates.billingStatus = 'active';
          updates.subscriptionStatus = 'active';
          updates.trialEndsAt = null;
          updates.graceEndsAt = null;
        }
        if (session.customer_email) updates.billingEmail = session.customer_email;
        const updated = { ...tenant, ...updates };
        await kv.put('tenant:' + tenantId, JSON.stringify(updated));
        if (customerId) {
          await kv.put(STRIPE_CUSTOMER_PREFIX + customerId, tenantId);
        }
        if (session.subscription) {
          await kv.put('tenant_sub_by_sub:' + session.subscription, tenantId);
        }
      }
    }
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const sub = body.data?.object;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
    let tenantId = sub.metadata?.tenantId || await resolveTenantIdByCustomer(kv, customerId);
    if (!tenantId) {
      const subs = await kv.get('tenant_sub_by_sub:' + sub.id, 'text');
      if (subs) tenantId = subs;
    }
    if (tenantId) {
      const updates = subscriptionToBillingUpdates(sub);
      if (type === 'customer.subscription.deleted') {
        updates.billingStatus = 'inactive';
        updates.subscriptionStatus = 'canceled';
        updates.stripeSubscriptionId = null;
        updates.stripePriceId = null;
        updates.currentPeriodEnd = null;
        updates.nextPaymentDate = null;
        updates.cancelAtPeriodEnd = false;
      }
      await updateTenantBilling(kv, tenantId, updates);
      await kv.put('tenant_sub_by_sub:' + sub.id, tenantId);
    }
  }

  if (type === 'invoice.payment_failed') {
    const invoice = body.data?.object;
    const subscriptionId = invoice.subscription;
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    if (subscriptionId) {
      let tenantId = await kv.get('tenant_sub_by_sub:' + subscriptionId, 'text');
      if (!tenantId) tenantId = await resolveTenantIdByCustomer(kv, customerId);
      if (tenantId) {
        await updateTenantBilling(kv, tenantId, {
          billingStatus: 'grace_period',
          subscriptionStatus: 'past_due',
          graceEndsAt: Date.now() + GRACE_DURATION_MS,
          updatedAt: Date.now(),
        });
      }
    }
  }

  return { ok: true, status: 200 };
}
