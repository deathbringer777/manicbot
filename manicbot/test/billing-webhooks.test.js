import { describe, it, expect, beforeEach } from 'vitest';
import { verifyStripeSignature, handleStripeWebhook } from '../src/billing/webhooks.js';
import { putTenant, getTenant } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv };
}

async function computeStripeSignature(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = timestamp + '.' + (typeof payload === 'string' ? payload : JSON.stringify(payload));
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { signature: `t=${timestamp},v1=${v1}`, timestamp };
}

describe('Stripe webhook signature', () => {
  it('verifyStripeSignature returns false for empty secret', async () => {
    expect(await verifyStripeSignature('{}', '', '')).toBe(false);
  });

  it('verifyStripeSignature returns true for valid signature', async () => {
    const payload = '{"id":"evt_1"}';
    const secret = 'whsec_test123';
    const { signature } = await computeStripeSignature(payload, secret);
    expect(await verifyStripeSignature(payload, signature, secret)).toBe(true);
  });

  it('verifyStripeSignature returns false for wrong secret', async () => {
    const payload = '{"id":"evt_1"}';
    const { signature } = await computeStripeSignature(payload, 'whsec_right');
    expect(await verifyStripeSignature(payload, signature, 'whsec_wrong')).toBe(false);
  });

  it('verifyStripeSignature accepts uppercase v1 hex (timing-safe compare)', async () => {
    const payload = '{"id":"evt_1"}';
    const secret = 'whsec_test123';
    const { signature } = await computeStripeSignature(payload, secret);
    const upper = signature.replace(/v1=([0-9a-f]+)/, (_, hex) => `v1=${hex.toUpperCase()}`);
    expect(upper).not.toBe(signature);
    expect(await verifyStripeSignature(payload, upper, secret)).toBe(true);
  });

  // #P0-2 — replay tolerance was tightened from ±300s to ±120s. The signature
  // verifier must reject forged-but-valid signatures whose `t=` falls outside
  // the new window so an attacker who captures a webhook payload can't replay
  // it minutes later.
  async function signWithCustomTimestamp(payload, secret, timestamp) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signedPayload = timestamp + '.' + payload;
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `t=${timestamp},v1=${v1}`;
  }

  it('rejects timestamps older than 120s (replay defence) (#P0-2)', async () => {
    const payload = '{"id":"evt_replay"}';
    const secret = 'whsec_t1';
    const oldTs = Math.floor(Date.now() / 1000) - 121;
    const sig = await signWithCustomTimestamp(payload, secret, oldTs);
    expect(await verifyStripeSignature(payload, sig, secret)).toBe(false);
  });

  it('accepts timestamps inside the 120s window', async () => {
    const payload = '{"id":"evt_fresh"}';
    const secret = 'whsec_t1';
    // 119s old — just inside the new tolerance.
    const ts = Math.floor(Date.now() / 1000) - 119;
    const sig = await signWithCustomTimestamp(payload, secret, ts);
    expect(await verifyStripeSignature(payload, sig, secret)).toBe(true);
  });

  it('rejects far-future timestamps (clock skew defence)', async () => {
    const payload = '{"id":"evt_future"}';
    const secret = 'whsec_t1';
    const futureTs = Math.floor(Date.now() / 1000) + 200;
    const sig = await signWithCustomTimestamp(payload, secret, futureTs);
    expect(await verifyStripeSignature(payload, sig, secret)).toBe(false);
  });
});

describe('handleStripeWebhook (D1)', () => {
  let ctx;
  const webhookSecret = 'whsec_test';

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('returns 401 for invalid signature', async () => {
    const r = await handleStripeWebhook(ctx, '{}', 't=1,v1=wrong', webhookSecret);
    expect(r.status).toBe(401);
    expect(r.ok).toBe(false);
  });

  it('returns 200 and skips duplicate event', async () => {
    const payload = JSON.stringify({ id: 'evt_dup', type: 'checkout.session.completed', data: { object: {} } });
    const { signature } = await computeStripeSignature(payload, webhookSecret);
    await handleStripeWebhook(ctx, payload, signature, webhookSecret);
    const r = await handleStripeWebhook(ctx, payload, signature, webhookSecret);
    expect(r.status).toBe(200);
    expect(r.skipped).toBe(true);
  });

  it('processes checkout.session.completed and updates tenant billing', async () => {
    await putTenant(ctx, 'default', { id: 'default', name: 'Test', active: true, createdAt: Date.now(), updatedAt: Date.now() });
    const payload = JSON.stringify({
      id: 'evt_checkout_2', type: 'checkout.session.completed',
      data: { object: { customer: 'cus_ABC', subscription: 'sub_123', customer_email: 'owner@test.com', metadata: { tenantId: 'default' } } },
    });
    const { signature } = await computeStripeSignature(payload, webhookSecret);
    const r = await handleStripeWebhook(ctx, payload, signature, webhookSecret);
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    const tenant = await getTenant(ctx, 'default');
    expect(tenant.stripeCustomerId).toBe('cus_ABC');
    expect(tenant.stripeSubscriptionId).toBe('sub_123');
    expect(tenant.billingEmail).toBe('owner@test.com');
  });
});
