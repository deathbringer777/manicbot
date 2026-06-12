/**
 * promoCodes.mintSeasonalPromo — idempotent seasonal subscription promo mint
 * over the Stripe coupon + promotion_code mechanics, persisted to
 * subscription_promo_codes. Stripe calls are mocked; we assert the Result
 * pattern, idempotency (persisted code wins, no re-mint), input validation,
 * and that livemode is recorded from the Stripe response.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const ensureCoupon = vi.fn();
const createPromotionCode = vi.fn();
vi.mock('../src/billing/stripe.js', () => ({
  ensureCoupon: (...a) => ensureCoupon(...a),
  createPromotionCode: (...a) => createPromotionCode(...a),
}));

const { mintSeasonalPromo, getPromoByCode } = await import('../src/billing/promoCodes.js');

const run = (ctx, sql, ...b) => ctx.db.prepare(sql).bind(...b).run();
const all = async (ctx, sql, ...b) => (await ctx.db.prepare(sql).bind(...b).all()).results;

function makePromoCtx() {
  const ctx = makeCtx({ tenantId: 't_a' });
  ctx.stripeSecretKey = 'sk_test_x';
  return ctx;
}

beforeEach(() => {
  ensureCoupon.mockReset();
  createPromotionCode.mockReset();
  ensureCoupon.mockResolvedValue({ id: 'MSG_WIOSNA20_20', percent_off: 20, duration: 'once' });
  createPromotionCode.mockResolvedValue({ id: 'promo_123', code: 'WIOSNA20', livemode: false });
});

describe('mintSeasonalPromo', () => {
  it('mints + persists a new promo (Result.data populated, livemode from Stripe)', async () => {
    const ctx = makePromoCtx();
    const res = await mintSeasonalPromo(ctx, { code: 'WIOSNA20', percentOff: 20, campaignId: 'camp_1' });
    expect(res.error).toBeNull();
    expect(res.data.code).toBe('WIOSNA20');
    expect(res.data.stripe_promo_id).toBe('promo_123');
    expect(res.data.livemode).toBe(0);
    expect(ensureCoupon).toHaveBeenCalledTimes(1);
    expect(createPromotionCode).toHaveBeenCalledTimes(1);
    const rows = await all(ctx, 'SELECT * FROM subscription_promo_codes');
    expect(rows.length).toBe(1);
  });

  it('is idempotent — a persisted code returns the existing row without re-minting', async () => {
    const ctx = makePromoCtx();
    await mintSeasonalPromo(ctx, { code: 'WIOSNA20', percentOff: 20 });
    ensureCoupon.mockClear();
    createPromotionCode.mockClear();
    const res2 = await mintSeasonalPromo(ctx, { code: 'WIOSNA20', percentOff: 20 });
    expect(res2.error).toBeNull();
    expect(res2.data.code).toBe('WIOSNA20');
    expect(ensureCoupon).not.toHaveBeenCalled();
    expect(createPromotionCode).not.toHaveBeenCalled();
  });

  it('rejects invalid percent_off', async () => {
    const ctx = makePromoCtx();
    const res = await mintSeasonalPromo(ctx, { code: 'X', percentOff: 0 });
    expect(res.error).toBe('invalid_promo_input');
    expect(res.data).toBeNull();
  });

  it('returns stripe_unconfigured when no secret key', async () => {
    const ctx = makeCtx({ tenantId: 't_a' }); // no stripeSecretKey
    const res = await mintSeasonalPromo(ctx, { code: 'X', percentOff: 20 });
    expect(res.error).toBe('stripe_unconfigured');
  });

  it('surfaces a Stripe failure as a Result error, persists nothing', async () => {
    const ctx = makePromoCtx();
    ensureCoupon.mockRejectedValueOnce(new Error('coupon economics mismatch'));
    const res = await mintSeasonalPromo(ctx, { code: 'BAD', percentOff: 20 });
    expect(res.data).toBeNull();
    expect(res.error).toMatch(/economics/);
    const rows = await all(ctx, 'SELECT * FROM subscription_promo_codes');
    expect(rows.length).toBe(0);
  });

  it('records livemode=1 when Stripe says livemode', async () => {
    const ctx = makePromoCtx();
    createPromotionCode.mockResolvedValueOnce({ id: 'promo_live', code: 'LIVE10', livemode: true });
    const res = await mintSeasonalPromo(ctx, { code: 'LIVE10', percentOff: 10 });
    expect(res.data.livemode).toBe(1);
  });
});
