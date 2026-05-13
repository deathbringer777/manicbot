/**
 * Stripe charge.dispute.created — resolve the customer (and therefore the
 * tenant) when dispute.charge is a string id.
 *
 * Stripe sends dispute.charge as a string in the default webhook payload.
 * The pre-fix branch left customerId = null and dropped the dispute from
 * analytics entirely; ops had no way to map a dispute back to a tenant
 * without manual Stripe-dashboard work. We now GET /v1/charges/{id} when
 * a STRIPE_SECRET_KEY is configured and pull customer off the charge.
 *
 * Failure modes covered:
 *   - happy path: fetch returns charge with customer → analytics row tagged
 *   - no STRIPE_SECRET_KEY in env → behave as before (no fetch, no tag)
 *   - fetch non-200 → no tenant tag, no crash
 *   - fetch throws → no tenant tag, no crash
 *   - expanded charge (dispute.charge is already an object) → no fetch
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleStripeWebhook } from '../src/billing/webhooks.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { nowSec } from '../src/utils/time.js';

const SECRET = 'whsec_dispute_test';
const TENANT_ID = 't_dispute';
const CUSTOMER_ID = 'cus_dispute_42';
const CHARGE_ID = 'ch_3O_string_form';

function makeCtx(overrides = {}) {
  const db = createMockD1();
  const kv = makeMockKv();
  // seed stripe_customers so the lookup post-fetch finds a tenant
  db._getTable('stripe_customers').push({ customer_id: CUSTOMER_ID, tenant_id: TENANT_ID });
  db._getTable('tenants').push({ id: TENANT_ID, name: 'Test Salon', plan: 'pro' });
  return {
    db, kv, globalKv: kv,
    stripeSecretKey: 'sk_test_default', // override in `overrides` if needed
    ...overrides,
  };
}

async function signPayload(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${raw}`));
  const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { signature: `t=${ts},v1=${v1}` };
}

async function fireDispute(ctx, disputeOverrides = {}, eventOverrides = {}) {
  const event = {
    id: 'evt_dispute_' + Math.random().toString(36).slice(2),
    type: 'charge.dispute.created',
    data: {
      object: {
        id: 'dp_test_1',
        amount: 5000,
        reason: 'fraudulent',
        charge: CHARGE_ID, // string form — the common case
        ...disputeOverrides,
      },
    },
    ...eventOverrides,
  };
  const raw = JSON.stringify(event);
  const { signature } = await signPayload(raw, SECRET);
  return handleStripeWebhook(ctx, raw, signature, SECRET);
}

function expectDisputeAnalyticsRow(ctx, expectedTenantId) {
  const rows = ctx.db._getTable('analytics_events').filter(r => r.event === 'billing.dispute');
  if (expectedTenantId === null) {
    expect(rows).toHaveLength(0);
    return;
  }
  expect(rows).toHaveLength(1);
  expect(rows[0].tenant_id).toBe(expectedTenantId);
}

describe('Stripe charge.dispute.created — customer resolution', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves tenant via Stripe charge lookup when dispute.charge is a string id', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: CHARGE_ID, customer: CUSTOMER_ID }),
    });
    const ctx = makeCtx();
    const res = await fireDispute(ctx);
    expect(res.ok).toBe(true);
    // Confirm we hit Stripe with the right URL + auth.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`https://api.stripe.com/v1/charges/${CHARGE_ID}`);
    expect(opts?.headers?.Authorization).toBe('Bearer sk_test_default');
    expectDisputeAnalyticsRow(ctx, TENANT_ID);
  });

  it('does NOT fetch when dispute.charge is already an expanded object (no string form)', async () => {
    const ctx = makeCtx();
    const res = await fireDispute(ctx, {
      charge: { id: CHARGE_ID, customer: CUSTOMER_ID },
      payment_intent: { customer: CUSTOMER_ID },
    });
    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expectDisputeAnalyticsRow(ctx, TENANT_ID);
  });

  it('skips the fetch when STRIPE_SECRET_KEY is unset (no behaviour change vs pre-fix)', async () => {
    const ctx = makeCtx({ stripeSecretKey: null });
    const res = await fireDispute(ctx);
    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    // tenant cannot be resolved without the API call → analytics row omitted
    expectDisputeAnalyticsRow(ctx, null);
  });

  it('does not crash + emits no tenant tag when Stripe returns non-200', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: 'oops' } }) });
    const ctx = makeCtx();
    const res = await fireDispute(ctx);
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expectDisputeAnalyticsRow(ctx, null);
  });

  it('does not crash + emits no tenant tag when Stripe fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const ctx = makeCtx();
    const res = await fireDispute(ctx);
    expect(res.ok).toBe(true);
    expectDisputeAnalyticsRow(ctx, null);
  });

  it('resolves tenant when fetch returns a charge but customer is unknown to our stripe_customers table', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: CHARGE_ID, customer: 'cus_unknown' }),
    });
    const ctx = makeCtx();
    const res = await fireDispute(ctx);
    expect(res.ok).toBe(true);
    // Stripe returned a customer, but we don't have it mapped → no tenant tag
    expectDisputeAnalyticsRow(ctx, null);
  });
});
