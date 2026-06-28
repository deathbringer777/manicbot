/**
 * Integration: Stripe webhook → Meta Conversions API.
 *
 * Proves the wiring in handleStripeWebhook:
 *  - invoice.paid (amount > 0)            → Purchase (value + currency, hashed email)
 *  - checkout.session.completed (sub)     → CompleteRegistration (hashed email)
 *  - $0 invoice                           → no Purchase
 *  - CAPI unconfigured (no pixel/token)   → no CAPI call, webhook still 200
 *  - CAPI failure                         → never breaks the webhook (still 200)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { handleStripeWebhook } from '../src/billing/webhooks.js';
import { putTenant } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { nowSec } from '../src/utils/time.js';

const SECRET = 'whsec_capi_test';
const TENANT_ID = 'tenant_capi_1';
const CUSTOMER_ID = 'cus_capi_1';
const PIXEL = '869658089071782';
const TOKEN = 'EAA-capi-test-token';
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

function capiCtx(overrides = {}) {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, metaCapiPixelId: PIXEL, metaCapiToken: TOKEN, ...overrides };
}

async function seedTenant(ctx) {
  await putTenant(ctx, TENANT_ID, {
    id: TENANT_ID, name: 'Salon', active: 1, plan: 'pro', billingStatus: 'trialing',
    trialEndsAt: nowSec() + 14 * 86400, createdAt: nowSec(), updatedAt: nowSec(),
  });
  await ctx.db.prepare('INSERT OR REPLACE INTO stripe_customers (customer_id, tenant_id) VALUES (?, ?)')
    .bind(CUSTOMER_ID, TENANT_ID).run();
}

async function sign(payload, secret = SECRET) {
  const ts = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
  const v1 = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${ts},v1=${v1}`;
}

async function fire(ctx, event) {
  const payload = JSON.stringify(event);
  return handleStripeWebhook(ctx, payload, await sign(payload), SECRET);
}

function capiCalls(fetchMock) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes('graph.facebook.com'));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Stripe webhook → Meta CAPI', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ events_received: 1 }), text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('invoice.paid (amount > 0) → Purchase with value, currency and hashed email', async () => {
    const ctx = capiCtx();
    await seedTenant(ctx);
    const res = await fire(ctx, {
      id: 'evt_inv_1', type: 'invoice.paid',
      data: { object: { id: 'in_1', customer: CUSTOMER_ID, customer_email: 'Owner@Salon.com', amount_paid: 4500, currency: 'pln', subscription: 'sub_1' } },
    });
    expect(res.status).toBe(200);
    const calls = capiCalls(fetchMock);
    expect(calls.length).toBe(1);
    const sent = JSON.parse(calls[0][1].body);
    const ev = sent.data[0];
    expect(ev.event_name).toBe('Purchase');
    expect(ev.event_id).toBe('inv_in_1');
    expect(ev.custom_data.value).toBe(45);
    expect(ev.custom_data.currency).toBe('PLN');
    expect(ev.user_data.em).toEqual([sha256('owner@salon.com')]);
    // plaintext email must never leave the Worker
    expect(JSON.stringify(sent).toLowerCase()).not.toContain('owner@salon.com');
  });

  it('checkout.session.completed (subscription) → CompleteRegistration', async () => {
    const ctx = capiCtx();
    await seedTenant(ctx);
    const res = await fire(ctx, {
      id: 'evt_co_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', customer: CUSTOMER_ID, customer_email: 'owner@salon.com', subscription: 'sub_1', metadata: { tenantId: TENANT_ID, plan: 'pro' } } },
    });
    expect(res.status).toBe(200);
    const calls = capiCalls(fetchMock);
    expect(calls.length).toBe(1);
    const ev = JSON.parse(calls[0][1].body).data[0];
    expect(ev.event_name).toBe('CompleteRegistration');
    expect(ev.event_id).toBe('reg_cs_1');
    expect(ev.user_data.em).toEqual([sha256('owner@salon.com')]);
  });

  it('$0 invoice (trial-start / fully discounted) → no Purchase', async () => {
    const ctx = capiCtx();
    await seedTenant(ctx);
    await fire(ctx, {
      id: 'evt_inv_0', type: 'invoice.paid',
      data: { object: { id: 'in_0', customer: CUSTOMER_ID, customer_email: 'owner@salon.com', amount_paid: 0, currency: 'pln' } },
    });
    expect(capiCalls(fetchMock).length).toBe(0);
  });

  it('CAPI unconfigured → no CAPI call, webhook still 200', async () => {
    const ctx = capiCtx({ metaCapiPixelId: null, metaCapiToken: null });
    await seedTenant(ctx);
    const res = await fire(ctx, {
      id: 'evt_inv_2', type: 'invoice.paid',
      data: { object: { id: 'in_2', customer: CUSTOMER_ID, customer_email: 'owner@salon.com', amount_paid: 4500, currency: 'pln' } },
    });
    expect(res.status).toBe(200);
    expect(capiCalls(fetchMock).length).toBe(0);
  });

  it('CAPI network failure never breaks the billing webhook', async () => {
    fetchMock.mockImplementation((url) =>
      String(url).includes('graph.facebook.com')
        ? Promise.reject(new Error('capi down'))
        : Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
    );
    const ctx = capiCtx();
    await seedTenant(ctx);
    const res = await fire(ctx, {
      id: 'evt_inv_3', type: 'invoice.paid',
      data: { object: { id: 'in_3', customer: CUSTOMER_ID, customer_email: 'owner@salon.com', amount_paid: 4500, currency: 'pln' } },
    });
    expect(res.status).toBe(200);
  });
});
