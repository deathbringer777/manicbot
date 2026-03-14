import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyStripeSignature,
  handleStripeWebhook,
} from '../src/billing/webhooks.js';

function makeMockKv() {
  const store = new Map();
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value, _opts) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
  };
}

async function computeStripeSignature(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = timestamp + '.' + (typeof payload === 'string' ? payload : JSON.stringify(payload));
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const v1 = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { signature: `t=${timestamp},v1=${v1}`, timestamp, payload: signedPayload };
}

describe('Stripe webhook signature', () => {
  it('verifyStripeSignature returns false for empty secret', async () => {
    const ok = await verifyStripeSignature('{}', '', '');
    expect(ok).toBe(false);
  });

  it('verifyStripeSignature returns true for valid signature', async () => {
    const payload = '{"id":"evt_1"}';
    const secret = 'whsec_test123';
    const { signature } = await computeStripeSignature(payload, secret);
    const ok = await verifyStripeSignature(payload, signature, secret);
    expect(ok).toBe(true);
  });

  it('verifyStripeSignature returns false for wrong secret', async () => {
    const payload = '{"id":"evt_1"}';
    const { signature } = await computeStripeSignature(payload, 'whsec_right');
    const ok = await verifyStripeSignature(payload, signature, 'whsec_wrong');
    expect(ok).toBe(false);
  });
});

describe('handleStripeWebhook', () => {
  let kv;
  const webhookSecret = 'whsec_test';

  beforeEach(() => {
    kv = makeMockKv();
  });

  it('returns 401 for invalid signature', async () => {
    const r = await handleStripeWebhook(kv, '{}', 't=1,v1=wrong', webhookSecret);
    expect(r.status).toBe(401);
    expect(r.ok).toBe(false);
  });

  it('returns 200 and skips duplicate event', async () => {
    const payload = JSON.stringify({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { object: {} },
    });
    const { signature } = await computeStripeSignature(payload, webhookSecret);
    await handleStripeWebhook(kv, payload, signature, webhookSecret);
    const r = await handleStripeWebhook(kv, payload, signature, webhookSecret);
    expect(r.status).toBe(200);
    expect(r.skipped).toBe(true);
  });

  it('processes checkout.session.completed and stores tenantId by customer', async () => {
    const payload = JSON.stringify({
      id: 'evt_checkout_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_ABC',
          subscription: 'sub_123',
          customer_email: 'owner@test.com',
          metadata: { tenantId: 'default' },
        },
      },
    });
    await kv.put('tenant:default', JSON.stringify({ id: 'default', name: 'Test', active: true }));
    const { signature } = await computeStripeSignature(payload, webhookSecret);
    const r = await handleStripeWebhook(kv, payload, signature, webhookSecret);
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    const tenantRaw = await kv.get('tenant:default', 'json');
    expect(tenantRaw.stripeCustomerId).toBe('cus_ABC');
    expect(tenantRaw.stripeSubscriptionId).toBe('sub_123');
    expect(tenantRaw.billingEmail).toBe('owner@test.com');
    const byCustomer = await kv.get('stripe_customer:cus_ABC', 'text');
    expect(byCustomer).toBe('default');
  });
});
