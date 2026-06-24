/**
 * Tests for phaseBillingReconcileStripe — the Stripe divergence backstop.
 *
 * Product contract pinned here:
 *   - A tenant marked cancelled/inactive locally that STILL holds a live,
 *     still-charging Stripe subscription (status active/trialing/past_due and
 *     NOT cancel_at_period_end) → the phase flips cancel_at_period_end on Stripe
 *     and mirrors the flag locally. This is the "cancelled long ago but Stripe
 *     keeps billing me" repair.
 *   - A tenant whose Stripe sub already has cancel_at_period_end=true → no-op.
 *   - A tenant whose Stripe sub is gone (null) → clear the stale local sub id,
 *     no cancel call.
 *   - A FRESH row (updated_at within the 3-day staleness guard) → never touched,
 *     so a checkout mid-webhook is not mistaken for a divergence.
 *   - billing_status='active' rows are never candidates (only inactive/canceled).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { putTenant, getTenant } from '../src/tenant/storage.js';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));

vi.mock('../src/billing/stripe.js', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getSubscription: vi.fn(),
    cancelSubscriptionAtPeriodEnd: vi.fn(async () => ({ id: 'sub', cancel_at_period_end: true })),
    voidOpenInvoicesForCustomer: vi.fn(async () => ({ voided: [] })),
  };
});

const { getSubscription, cancelSubscriptionAtPeriodEnd, voidOpenInvoicesForCustomer } = await import('../src/billing/stripe.js');
const { phaseBillingReconcileStripe } = await import('../src/handlers/cron.js');

const DAY = 86400;
const NOW = Math.floor(Date.now() / 1000);
const OLD = NOW - 10 * DAY; // comfortably past the 3-day staleness guard

function makeCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, tenantId: 't_cron_host', stripeSecretKey: 'sk_test_x' };
}

async function seedTenant(ctx, id, overrides = {}) {
  await putTenant(ctx, id, {
    id,
    salon: { name: id },
    plan: 'pro',
    billingStatus: 'inactive',
    stripeSubscriptionId: `sub_${id}`,
    stripeCustomerId: `cus_${id}`,
    cancelAtPeriodEnd: false,
    updatedAt: OLD,
    createdAt: OLD,
    ...overrides,
  });
}

beforeEach(() => {
  getSubscription.mockReset();
  cancelSubscriptionAtPeriodEnd.mockReset();
  cancelSubscriptionAtPeriodEnd.mockResolvedValue({ id: 'sub', cancel_at_period_end: true });
  voidOpenInvoicesForCustomer.mockReset();
  voidOpenInvoicesForCustomer.mockResolvedValue({ voided: [] });
});

describe('phaseBillingReconcileStripe — divergence repair', () => {
  it('cancels a live, still-charging sub for a tenant marked inactive locally', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_div', { billingStatus: 'inactive' });
    getSubscription.mockResolvedValue({ id: 'sub_t_div', status: 'active', cancel_at_period_end: false });

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(cancelSubscriptionAtPeriodEnd).toHaveBeenCalledWith('sk_test_x', 'sub_t_div');
    // Open/unpaid invoices are voided too so dunning retries + emails stop.
    expect(voidOpenInvoicesForCustomer).toHaveBeenCalledWith('sk_test_x', 'cus_t_div');
    const t = await getTenant(ctx, 't_div');
    expect(t.cancelAtPeriodEnd).toBe(true);
  });

  it('also repairs a "canceled" billing_status row', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_can', { billingStatus: 'canceled' });
    getSubscription.mockResolvedValue({ id: 'sub_t_can', status: 'past_due', cancel_at_period_end: false });

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(cancelSubscriptionAtPeriodEnd).toHaveBeenCalledTimes(1);
  });

  it('does NOT cancel when Stripe already has cancel_at_period_end=true', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_already', { billingStatus: 'inactive' });
    getSubscription.mockResolvedValue({ id: 'sub_t_already', status: 'active', cancel_at_period_end: true });

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('clears the stale local sub id when the Stripe sub is gone (null)', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_gone', { billingStatus: 'inactive' });
    getSubscription.mockResolvedValue(null);

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
    const t = await getTenant(ctx, 't_gone');
    expect(t.stripeSubscriptionId).toBeNull();
  });

  it('preserves the local sub id when getSubscription throws (transient error — no orphaning)', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_transient', { billingStatus: 'inactive' });
    // A transient Stripe failure (5xx / 429 / network / timeout) now THROWS —
    // only a genuine 404 returns null. The per-row try/catch must swallow it
    // WITHOUT clearing stripe_subscription_id; otherwise the row drops out of
    // the `stripe_subscription_id IS NOT NULL` candidate set and the divergence
    // becomes permanently invisible (the customer keeps getting charged).
    getSubscription.mockRejectedValue(new Error('Stripe getSubscription failed: 500'));

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
    const t = await getTenant(ctx, 't_transient');
    expect(t.stripeSubscriptionId).toBe('sub_t_transient');
  });

  it('never touches a FRESH row inside the 3-day staleness guard', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_fresh', { billingStatus: 'inactive', updatedAt: NOW - 60 });
    getSubscription.mockResolvedValue({ id: 'sub_t_fresh', status: 'active', cancel_at_period_end: false });

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(getSubscription).not.toHaveBeenCalled();
    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('never treats an active paying tenant as a divergence', async () => {
    const ctx = makeCtx();
    await seedTenant(ctx, 't_paying', { billingStatus: 'active' });
    getSubscription.mockResolvedValue({ id: 'sub_t_paying', status: 'active', cancel_at_period_end: false });

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(getSubscription).not.toHaveBeenCalled();
    expect(cancelSubscriptionAtPeriodEnd).not.toHaveBeenCalled();
  });

  it('no-ops without a Stripe secret key', async () => {
    const ctx = makeCtx();
    ctx.stripeSecretKey = null;
    await seedTenant(ctx, 't_nokey', { billingStatus: 'inactive' });

    await phaseBillingReconcileStripe(ctx, Date.now());

    expect(getSubscription).not.toHaveBeenCalled();
  });
});
