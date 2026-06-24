/**
 * getSubscription — error mapping (reconcile-safety regression).
 *
 * The billing reconcile cron (phaseBillingReconcileStripe) CLEARS a tenant's
 * stripe_subscription_id when getSubscription returns null. So null MUST mean
 * "genuinely gone" (HTTP 404) and nothing else. A transient failure
 * (5xx / 429 / network / timeout) must THROW, so the cron's per-row try/catch
 * preserves the id and retries on the next run — never orphaning a live
 * subscription and hiding the divergence forever (the customer would keep
 * getting charged with no way for the cron to catch it again).
 *
 * Before the fix, getSubscription went through stripeRequest, which returns a
 * parsed `{ error }` body for ANY non-2xx (and on network errors), so the
 * function returned null on a transient 500/429 too — the 500/429 cases below
 * would resolve to null instead of throwing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSubscription } from '../src/billing/stripe.js';

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('getSubscription — error mapping', () => {
  it('returns null on a genuine 404 (subscription gone → safe to clear local id)', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 404,
      ok: false,
      json: async () => ({ error: { code: 'resource_missing', message: 'No such subscription' } }),
    });
    await expect(getSubscription('sk_test', 'sub_gone')).resolves.toBeNull();
  });

  it('THROWS on a transient 500 (must NOT be mistaken for "gone")', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({ error: { message: 'Stripe server error' } }),
    });
    await expect(getSubscription('sk_test', 'sub_live')).rejects.toThrow(/server error|500/);
  });

  it('THROWS on a 429 rate-limit (transient — preserve, retry)', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 429,
      ok: false,
      json: async () => ({ error: { message: 'Too many requests' } }),
    });
    await expect(getSubscription('sk_test', 'sub_live')).rejects.toThrow();
  });

  it('propagates a network error / timeout as a throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('The operation timed out'));
    await expect(getSubscription('sk_test', 'sub_live')).rejects.toThrow(/timed out/);
  });

  it('returns the subscription object on 200', async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ id: 'sub_live', status: 'active', cancel_at_period_end: false }),
    });
    await expect(getSubscription('sk_test', 'sub_live')).resolves.toMatchObject({
      id: 'sub_live',
      status: 'active',
    });
  });
});
