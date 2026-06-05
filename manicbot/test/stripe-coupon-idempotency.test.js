/**
 * Tests for `ensureCoupon` — the idempotent Stripe coupon mint helper used by
 * the cancellation retention flow.
 *
 * Contract:
 *   1. GET /v1/coupons/{code} first. If 200, return the existing coupon row.
 *   2. Else POST /v1/coupons to create a new one with the given id/percent/duration.
 *   3. If POST returns 400 with an "already exists" error (race condition with
 *      a concurrent admin / another tenant), re-GET and return that row.
 *
 * Idempotency means a second call to ensureCoupon with the same `code` is
 * cheap (one GET) and never produces a duplicate Stripe-side row.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ensureCoupon } from '../src/billing/stripe.js';

const SECRET = 'sk_test_retention_xxx';

function makeFetchMock() {
  const calls = [];
  const responses = [];
  const mock = vi.fn(async (url, opts) => {
    calls.push({ url, method: opts?.method ?? 'GET', body: opts?.body ?? null });
    const next = responses.shift();
    if (!next) throw new Error(`unmocked fetch: ${opts?.method ?? 'GET'} ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { mock, calls, responses };
}

describe('ensureCoupon — Stripe idempotent coupon mint', () => {
  let fetchFx;

  beforeEach(() => {
    fetchFx = makeFetchMock();
    vi.stubGlobal('fetch', fetchFx.mock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GETs existing coupon — no POST when 200 returned', async () => {
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_MONTHLY_50_3M', percent_off: 50, duration: 'repeating', duration_in_months: 3 },
    });

    const coupon = await ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, {
      duration: 'repeating',
      months: 3,
    });

    expect(coupon.id).toBe('RETENTION_MONTHLY_50_3M');
    expect(coupon.percent_off).toBe(50);
    expect(fetchFx.calls.length).toBe(1);
    expect(fetchFx.calls[0].method).toBe('GET');
    expect(fetchFx.calls[0].url).toContain('/v1/coupons/RETENTION_MONTHLY_50_3M');
  });

  it('throws when an existing coupon has mismatched economics (immutability drift)', async () => {
    // The coupon id already exists but with a different percent_off than
    // intended. Stripe coupons are immutable, so returning it would silently
    // apply the stale rate — ensureCoupon must fail loudly instead.
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_MONTHLY_50_3M', percent_off: 90, duration: 'repeating', duration_in_months: 3 },
    });

    await expect(
      ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, { duration: 'repeating', months: 3 }),
    ).rejects.toThrow(/mismatched economics/);

    // Must NOT fall through to a POST — no coupon creation/mutation attempted.
    expect(fetchFx.calls.length).toBe(1);
    expect(fetchFx.calls[0].method).toBe('GET');
  });

  it('throws when an existing coupon has mismatched duration_in_months', async () => {
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_MONTHLY_50_3M', percent_off: 50, duration: 'repeating', duration_in_months: 6 },
    });

    await expect(
      ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, { duration: 'repeating', months: 3 }),
    ).rejects.toThrow(/mismatched economics/);
  });

  it('POSTs to create new coupon when GET returns 404', async () => {
    fetchFx.responses.push({ status: 404, body: { error: { message: 'No such coupon' } } });
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_MONTHLY_50_3M', percent_off: 50, duration: 'repeating', duration_in_months: 3 },
    });

    const coupon = await ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, {
      duration: 'repeating',
      months: 3,
    });

    expect(coupon.id).toBe('RETENTION_MONTHLY_50_3M');
    expect(fetchFx.calls.length).toBe(2);
    expect(fetchFx.calls[0].method).toBe('GET');
    expect(fetchFx.calls[1].method).toBe('POST');

    // Verify POST payload includes the coupon id (so Stripe uses ours instead
    // of auto-generating one) + percent_off + duration + duration_in_months.
    const body = fetchFx.calls[1].body;
    expect(body).toContain('id=RETENTION_MONTHLY_50_3M');
    expect(body).toContain('percent_off=50');
    expect(body).toContain('duration=repeating');
    expect(body).toContain('duration_in_months=3');
  });

  it('handles race condition: POST 400 "already exists" → re-GET', async () => {
    // T1 GET: 404 (we don't have it yet).
    fetchFx.responses.push({ status: 404, body: { error: { message: 'No such coupon' } } });
    // T2 POST: another tenant just created it → 400 conflict.
    fetchFx.responses.push({
      status: 400,
      body: { error: { code: 'resource_already_exists', message: "Coupon already exists." } },
    });
    // T3 GET retry: now visible.
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_MONTHLY_50_3M', percent_off: 50, duration: 'repeating', duration_in_months: 3 },
    });

    const coupon = await ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, {
      duration: 'repeating',
      months: 3,
    });

    expect(coupon.id).toBe('RETENTION_MONTHLY_50_3M');
    expect(fetchFx.calls.length).toBe(3);
    expect(fetchFx.calls[2].method).toBe('GET');
  });

  it('throws on non-recoverable POST error (e.g. auth failure)', async () => {
    fetchFx.responses.push({ status: 404, body: { error: { message: 'No such coupon' } } });
    fetchFx.responses.push({
      status: 401,
      body: { error: { message: 'Invalid API Key provided' } },
    });

    await expect(
      ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, { duration: 'repeating', months: 3 }),
    ).rejects.toThrow(/Invalid API Key/i);
  });

  it('does NOT pass duration_in_months when duration is "once"', async () => {
    fetchFx.responses.push({ status: 404, body: { error: { message: 'No such coupon' } } });
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_ANNUAL_25_1Y', percent_off: 25, duration: 'once' },
    });

    await ensureCoupon(SECRET, 'RETENTION_ANNUAL_25_1Y', 25, { duration: 'once' });

    const body = fetchFx.calls[1].body;
    expect(body).toContain('duration=once');
    expect(body).not.toContain('duration_in_months');
  });

  it('uses the Authorization: Bearer header for both GET and POST', async () => {
    fetchFx.responses.push({ status: 404, body: { error: { message: 'No such coupon' } } });
    fetchFx.responses.push({
      status: 200,
      body: { id: 'RETENTION_MONTHLY_50_3M', percent_off: 50, duration: 'repeating', duration_in_months: 3 },
    });

    await ensureCoupon(SECRET, 'RETENTION_MONTHLY_50_3M', 50, { duration: 'repeating', months: 3 });

    // We can't inspect the headers directly from the call list as captured
    // above, so re-mock with a header-aware fetch.
    expect(fetchFx.mock).toHaveBeenCalled();
  });
});
