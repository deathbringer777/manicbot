/**
 * Comprehensive Stripe subscription lifecycle tests.
 *
 * Covers:
 *  - Signature verification: valid, invalid, replay prevention (old/future ts)
 *  - checkout.session.completed → tenant activation + stripe_customers upsert
 *  - customer.subscription.updated → billing status + plan + currentPeriodEnd (seconds)
 *  - customer.subscription.deleted → tenant deactivation
 *  - invoice.payment_failed → grace_period + graceEndsAt
 *  - Idempotency: duplicate events are skipped
 *  - Tenant lookup via stripe_customers table (no metadata.tenantId fallback)
 *  - mapStripeStatusToBilling: all Stripe status → internal status mappings
 *  - currentPeriodEnd stored in SECONDS (not ms) — bug-fix regression
 *  - GRACE_DURATION_MS = 7 days constant
 *  - TRIAL_DURATION_MS = 14 days constant
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { verifyStripeSignature, handleStripeWebhook } from '../src/billing/webhooks.js';
import { mapStripeStatusToBilling } from '../src/billing/stripe.js';
import { putTenant, getTenant } from '../src/tenant/storage.js';
import { GRACE_DURATION_MS, TRIAL_DURATION_MS } from '../src/billing/config.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { nowSec } from '../src/utils/time.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, ...overrides };
}

async function signPayload(payload, secret, tsOverride) {
  const ts = tsOverride ?? Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signed = `${ts}.${raw}`;
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signed));
  const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { signature: `t=${ts},v1=${v1}`, raw };
}

const SECRET = 'whsec_test_secret_for_lifecycle_suite';
const TENANT_ID = 'tenant_test_123';
const CUSTOMER_ID = 'cus_test_lifecycle';
const SUB_ID = 'sub_test_lifecycle';

async function seedTenant(ctx, overrides = {}) {
  await putTenant(ctx, TENANT_ID, {
    id: TENANT_ID,
    name: 'Test Salon',
    active: 1,
    plan: 'start',
    billingStatus: 'trialing',
    trialEndsAt: nowSec() + 14 * 86400,
    createdAt: nowSec(),
    updatedAt: nowSec(),
    ...overrides,
  });
}

async function seedStripeCustomer(ctx, customerId, tenantId) {
  await ctx.db
    .prepare('INSERT OR REPLACE INTO stripe_customers (customer_id, tenant_id) VALUES (?, ?)')
    .bind(customerId, tenantId)
    .run();
}

async function fire(ctx, event, secret = SECRET) {
  const payload = JSON.stringify(event);
  const { signature } = await signPayload(payload, secret);
  return handleStripeWebhook(ctx, payload, signature, secret);
}

// ─── mapStripeStatusToBilling ─────────────────────────────────────────────────

describe('mapStripeStatusToBilling', () => {
  const cases = [
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['unpaid', 'unpaid'],
    ['canceled', 'canceled'],
    ['paused', 'paused'],
    ['incomplete', 'incomplete'],
    ['incomplete_expired', 'inactive'],
    ['unknown_status', 'inactive'],
    ['', 'inactive'],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(mapStripeStatusToBilling(input)).toBe(expected);
    });
  }
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Billing constants', () => {
  it('TRIAL_DURATION_MS = 14 days', () => {
    expect(TRIAL_DURATION_MS).toBe(14 * 24 * 3600 * 1000);
  });

  it('GRACE_DURATION_MS = 7 days', () => {
    expect(GRACE_DURATION_MS).toBe(7 * 24 * 3600 * 1000);
  });
});

// ─── Signature verification ───────────────────────────────────────────────────

describe('verifyStripeSignature — edge cases', () => {
  it('rejects event with timestamp > 5 min in the past (replay prevention)', async () => {
    const staleTs = Math.floor(Date.now() / 1000) - 310; // 5m10s ago
    const payload = '{"id":"evt_old"}';
    const { signature } = await signPayload(payload, SECRET, staleTs);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(false);
  });

  it('rejects event with timestamp > 5 min in the future', async () => {
    const futureTs = Math.floor(Date.now() / 1000) + 310;
    const payload = '{"id":"evt_future"}';
    const { signature } = await signPayload(payload, SECRET, futureTs);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(false);
  });

  it('accepts event within ±5 min window', async () => {
    const recentTs = Math.floor(Date.now() / 1000) - 60;
    const payload = '{"id":"evt_recent"}';
    const { signature } = await signPayload(payload, SECRET, recentTs);
    expect(await verifyStripeSignature(payload, signature, SECRET)).toBe(true);
  });

  it('rejects malformed signature header (no t= or v1=)', async () => {
    expect(await verifyStripeSignature('{}', 'garbage', SECRET)).toBe(false);
  });

  it('rejects non-finite timestamp', async () => {
    expect(await verifyStripeSignature('{}', 't=abc,v1=abc', SECRET)).toBe(false);
  });

  it('rejects null secret', async () => {
    expect(await verifyStripeSignature('{}', 't=1,v1=abc', null)).toBe(false);
  });
});

// ─── checkout.session.completed ───────────────────────────────────────────────

describe('checkout.session.completed', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await seedTenant(ctx);
  });

  it('records stripeCustomerId + subscriptionId and defers billing status to subscription.updated', async () => {
    // checkout.session.completed only stores IDs; billing status is NOT set here.
    // It is correctly set by the subsequent customer.subscription.updated event
    // (which Stripe always fires after checkout), allowing trialing vs active to
    // be determined from the full subscription object rather than assumed 'active'.
    const checkoutEvent = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: CUSTOMER_ID,
          subscription: SUB_ID,
          customer_email: 'owner@salon.com',
          metadata: { tenantId: TENANT_ID },
        },
      },
    };
    const r = await fire(ctx, checkoutEvent);
    expect(r).toMatchObject({ ok: true, status: 200 });

    // After checkout only — IDs recorded, billing status not yet changed
    const afterCheckout = await getTenant(ctx, TENANT_ID);
    expect(afterCheckout.stripeCustomerId).toBe(CUSTOMER_ID);
    expect(afterCheckout.stripeSubscriptionId).toBe(SUB_ID);
    expect(afterCheckout.billingEmail).toBe('owner@salon.com');
    expect(afterCheckout.graceEndsAt).toBeNull();

    // Stripe fires customer.subscription.updated immediately after checkout
    const subUpdatedEvent = {
      id: 'evt_sub_upd_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID, status: 'active',
          current_period_end: nowSec() + 30 * 86400,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: 'price_pro_monthly' } }] },
        },
      },
    };
    await fire(ctx, subUpdatedEvent);
    const afterSubUpdated = await getTenant(ctx, TENANT_ID);
    expect(afterSubUpdated.billingStatus).toBe('active');
  });

  it('upserts stripe_customers row', async () => {
    const event = {
      id: 'evt_checkout_2',
      type: 'checkout.session.completed',
      data: { object: { customer: CUSTOMER_ID, metadata: { tenantId: TENANT_ID } } },
    };
    await fire(ctx, event);

    const row = await ctx.db
      .prepare('SELECT tenant_id FROM stripe_customers WHERE customer_id = ?')
      .bind(CUSTOMER_ID)
      .first();
    expect(row?.tenant_id).toBe(TENANT_ID);
  });

  it('does nothing when tenantId is missing from metadata', async () => {
    const event = {
      id: 'evt_checkout_3',
      type: 'checkout.session.completed',
      data: { object: { customer: CUSTOMER_ID, subscription: SUB_ID } },
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    const tenant = await getTenant(ctx, TENANT_ID);
    // Should still be in trialing (unchanged)
    expect(tenant.billingStatus).toBe('trialing');
  });
});

// ─── customer.subscription.updated ───────────────────────────────────────────

describe('customer.subscription.updated', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await seedTenant(ctx, { billingStatus: 'trialing', stripeCustomerId: CUSTOMER_ID });
    await seedStripeCustomer(ctx, CUSTOMER_ID, TENANT_ID);
  });

  it('updates billingStatus to active and stores currentPeriodEnd in SECONDS (not ms)', async () => {
    const periodEndSeconds = nowSec() + 30 * 86400; // 30 days from now in seconds
    const event = {
      id: 'evt_sub_updated_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'active',
          current_period_end: periodEndSeconds,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('active');
    expect(tenant.stripeSubscriptionId).toBe(SUB_ID);
    expect(tenant.stripePriceId).toBe('price_pro');

    // CRITICAL: must be stored in seconds, not milliseconds
    // If stored in ms (> 2000000000) it would be ~year 2033+ even for near-future dates
    expect(tenant.currentPeriodEnd).toBe(periodEndSeconds);
    expect(tenant.nextPaymentDate).toBe(periodEndSeconds);

    // Sanity: value should be a reasonable Unix seconds timestamp (< 2B)
    expect(tenant.currentPeriodEnd).toBeLessThan(2_000_000_000);
    expect(tenant.currentPeriodEnd).toBeGreaterThan(1_700_000_000);
  });

  it('updates cancelAtPeriodEnd flag correctly', async () => {
    const event = {
      id: 'evt_sub_cancel_flag',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'active',
          current_period_end: nowSec() + 86400,
          cancel_at_period_end: true,
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    };
    await fire(ctx, event);

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.cancelAtPeriodEnd).toBe(true);
  });

  it('maps past_due status correctly', async () => {
    const event = {
      id: 'evt_sub_past_due',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'past_due',
          current_period_end: nowSec() + 86400,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID,
          items: { data: [] },
        },
      },
    };
    await fire(ctx, event);

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('past_due');
    expect(tenant.subscriptionStatus).toBe('past_due');
  });

  it('resolves tenantId via stripe_customers table when no metadata', async () => {
    const event = {
      id: 'evt_sub_no_meta',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'active',
          current_period_end: nowSec() + 86400,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID, // no metadata.tenantId — must resolve via D1
          items: { data: [] },
        },
      },
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('active');
  });

  it('handles customer as object (not string)', async () => {
    const event = {
      id: 'evt_sub_cust_obj',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'active',
          current_period_end: nowSec() + 86400,
          cancel_at_period_end: false,
          customer: { id: CUSTOMER_ID }, // some webhook variants send full customer object
          items: { data: [] },
        },
      },
    };
    await fire(ctx, event);
    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('active');
  });
});

// ─── customer.subscription.deleted ───────────────────────────────────────────

describe('customer.subscription.deleted', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await seedTenant(ctx, {
      billingStatus: 'active',
      stripeCustomerId: CUSTOMER_ID,
      stripeSubscriptionId: SUB_ID,
      stripePriceId: 'price_pro',
      currentPeriodEnd: nowSec() + 86400,
    });
    await seedStripeCustomer(ctx, CUSTOMER_ID, TENANT_ID);
  });

  it('marks tenant as inactive and clears subscription data', async () => {
    const event = {
      id: 'evt_sub_deleted_1',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: SUB_ID,
          status: 'canceled',
          customer: CUSTOMER_ID,
          cancel_at_period_end: false,
          items: { data: [] },
        },
      },
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('inactive');
    expect(tenant.subscriptionStatus).toBe('canceled');
    expect(tenant.stripeSubscriptionId).toBeNull();
    expect(tenant.stripePriceId).toBeNull();
    expect(tenant.currentPeriodEnd).toBeNull();
    expect(tenant.nextPaymentDate).toBeNull();
    expect(tenant.cancelAtPeriodEnd).toBe(false);
  });

  it('does nothing if customer not in stripe_customers', async () => {
    const event = {
      id: 'evt_sub_deleted_unknown',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_unknown',
          status: 'canceled',
          customer: 'cus_unknown_xyz',
          items: { data: [] },
        },
      },
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    // Original tenant should be unchanged
    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('active');
  });
});

// ─── invoice.payment_failed ───────────────────────────────────────────────────

describe('invoice.payment_failed', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await seedTenant(ctx, { billingStatus: 'active', stripeCustomerId: CUSTOMER_ID });
    await seedStripeCustomer(ctx, CUSTOMER_ID, TENANT_ID);
  });

  it('sets grace_period + graceEndsAt (7 days from now)', async () => {
    const beforeFire = nowSec();
    const event = {
      id: 'evt_invoice_fail_1',
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: SUB_ID,
          customer: CUSTOMER_ID,
        },
      },
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('grace_period');
    expect(tenant.subscriptionStatus).toBe('past_due');

    // graceEndsAt should be ~7 days from now (in seconds)
    const expectedGrace = beforeFire + 7 * 24 * 3600;
    expect(tenant.graceEndsAt).toBeGreaterThanOrEqual(expectedGrace - 5);
    expect(tenant.graceEndsAt).toBeLessThanOrEqual(expectedGrace + 5);

    // Must be seconds not ms
    expect(tenant.graceEndsAt).toBeLessThan(2_000_000_000);
  });

  it('does nothing if no customer ID on invoice', async () => {
    const event = {
      id: 'evt_invoice_fail_no_cust',
      type: 'invoice.payment_failed',
      data: { object: { subscription: SUB_ID } }, // no customer field
    };
    const r = await fire(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('active'); // unchanged
  });

  it('handles customer as object', async () => {
    const event = {
      id: 'evt_invoice_fail_cust_obj',
      type: 'invoice.payment_failed',
      data: { object: { subscription: SUB_ID, customer: { id: CUSTOMER_ID } } },
    };
    await fire(ctx, event);

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.billingStatus).toBe('grace_period');
  });
});

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('Idempotency — duplicate events', () => {
  it('processes first event, skips identical second event', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx);

    const event = {
      id: 'evt_dedup_test',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: CUSTOMER_ID,
          subscription: SUB_ID,
          metadata: { tenantId: TENANT_ID },
        },
      },
    };
    const payload = JSON.stringify(event);
    const { signature } = await signPayload(payload, SECRET);

    const r1 = await handleStripeWebhook(ctx, payload, signature, SECRET);
    expect(r1.ok).toBe(true);
    expect(r1.skipped).toBeUndefined();

    // Need a fresh signature (new timestamp) for the second attempt
    // but same event ID — should be deduplicated by KV
    const { signature: sig2 } = await signPayload(payload, SECRET);
    const r2 = await handleStripeWebhook(ctx, payload, sig2, SECRET);
    expect(r2.ok).toBe(true);
    expect(r2.skipped).toBe(true);
    expect(r2.status).toBe(200);
  });

  it('processes two different events independently', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx);

    const event1 = { id: 'evt_a', type: 'checkout.session.completed', data: { object: { customer: CUSTOMER_ID, metadata: { tenantId: TENANT_ID } } } };
    const event2 = { id: 'evt_b', type: 'checkout.session.completed', data: { object: { customer: 'cus_other', metadata: {} } } };

    const r1 = await fire(ctx, event1);
    const r2 = await fire(ctx, event2);
    expect(r1.skipped).toBeUndefined();
    expect(r2.skipped).toBeUndefined();
  });
});

// ─── Auth and config guards ───────────────────────────────────────────────────

describe('handleStripeWebhook — guard cases', () => {
  it('returns 400 when ctx.db is null', async () => {
    const ctx = { db: null, kv: makeMockKv() };
    const r = await handleStripeWebhook(ctx, '{}', 't=1,v1=x', SECRET);
    expect(r.status).toBe(400);
    expect(r.ok).toBe(false);
  });

  it('returns 400 when payload is empty', async () => {
    const ctx = makeCtx();
    const r = await handleStripeWebhook(ctx, '', 't=1,v1=x', SECRET);
    expect(r.status).toBe(400);
  });

  it('returns 400 when webhookSecret is missing', async () => {
    const ctx = makeCtx();
    const r = await handleStripeWebhook(ctx, '{}', 't=1,v1=x', '');
    expect(r.status).toBe(400);
  });

  it('returns 200 for unknown event type (no-op)', async () => {
    const ctx = makeCtx();
    const r = await fire(ctx, { id: 'evt_unknown', type: 'some.new.event', data: {} });
    expect(r).toMatchObject({ ok: true, status: 200 });
  });
});

// ─── Subscription plan change flow ───────────────────────────────────────────

describe('Plan change via subscription.updated', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await seedTenant(ctx, {
      billingStatus: 'active',
      plan: 'start',
      stripePriceId: 'price_start',
      stripeCustomerId: CUSTOMER_ID,
    });
    await seedStripeCustomer(ctx, CUSTOMER_ID, TENANT_ID);
  });

  it('upgrades price ID on plan upgrade (admin changes price in Stripe)', async () => {
    const event = {
      id: 'evt_upgrade',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID,
          status: 'active',
          current_period_end: nowSec() + 30 * 86400,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: 'price_pro_monthly' } }] },
        },
      },
    };
    await fire(ctx, event);

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.stripePriceId).toBe('price_pro_monthly');
    expect(tenant.billingStatus).toBe('active');
    expect(tenant.subscriptionStatus).toBe('active');
  });

  it('period end is updated with each renewal', async () => {
    const firstPeriodEnd = nowSec() + 30 * 86400;
    const secondPeriodEnd = firstPeriodEnd + 30 * 86400;

    const event1 = {
      id: 'evt_renewal_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID, status: 'active',
          current_period_end: firstPeriodEnd,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    };
    await fire(ctx, event1);

    const event2 = {
      id: 'evt_renewal_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: SUB_ID, status: 'active',
          current_period_end: secondPeriodEnd,
          cancel_at_period_end: false,
          customer: CUSTOMER_ID,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    };
    await fire(ctx, event2);

    const tenant = await getTenant(ctx, TENANT_ID);
    expect(tenant.currentPeriodEnd).toBe(secondPeriodEnd);
  });
});

// ─── Full lifecycle ───────────────────────────────────────────────────────────

describe('Full subscription lifecycle', () => {
  it('trialing → active → grace → inactive → active (resubscribe)', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, { billingStatus: 'trialing' });
    await seedStripeCustomer(ctx, CUSTOMER_ID, TENANT_ID);

    // 1. Checkout completed — records IDs only (billing status deferred to subscription.updated)
    await fire(ctx, {
      id: 'lc_evt_1', type: 'checkout.session.completed',
      data: { object: { customer: CUSTOMER_ID, subscription: SUB_ID, metadata: { tenantId: TENANT_ID } } },
    });
    // Stripe fires subscription.updated immediately after checkout with the real status
    await fire(ctx, {
      id: 'lc_evt_1b', type: 'customer.subscription.updated',
      data: { object: { id: SUB_ID, status: 'active', current_period_end: nowSec() + 30 * 86400, cancel_at_period_end: false, customer: CUSTOMER_ID, items: { data: [] } } },
    });
    expect((await getTenant(ctx, TENANT_ID)).billingStatus).toBe('active');

    // 2. Payment fails → grace
    await fire(ctx, {
      id: 'lc_evt_2', type: 'invoice.payment_failed',
      data: { object: { subscription: SUB_ID, customer: CUSTOMER_ID } },
    });
    expect((await getTenant(ctx, TENANT_ID)).billingStatus).toBe('grace_period');

    // 3. Subscription canceled → inactive
    await fire(ctx, {
      id: 'lc_evt_3', type: 'customer.subscription.deleted',
      data: { object: { id: SUB_ID, status: 'canceled', customer: CUSTOMER_ID, items: { data: [] } } },
    });
    const afterCancel = await getTenant(ctx, TENANT_ID);
    expect(afterCancel.billingStatus).toBe('inactive');
    expect(afterCancel.stripeSubscriptionId).toBeNull();

    // 4. Re-subscribe (new checkout) → active again
    const newSubId = 'sub_resubscribe';
    await fire(ctx, {
      id: 'lc_evt_4', type: 'checkout.session.completed',
      data: { object: { customer: CUSTOMER_ID, subscription: newSubId, metadata: { tenantId: TENANT_ID } } },
    });
    // Stripe fires subscription.updated with the new active sub
    await fire(ctx, {
      id: 'lc_evt_4b', type: 'customer.subscription.updated',
      data: { object: { id: newSubId, status: 'active', current_period_end: nowSec() + 30 * 86400, cancel_at_period_end: false, customer: CUSTOMER_ID, items: { data: [] } } },
    });
    const afterResub = await getTenant(ctx, TENANT_ID);
    expect(afterResub.billingStatus).toBe('active');
    expect(afterResub.stripeSubscriptionId).toBe(newSubId);
  });
});
