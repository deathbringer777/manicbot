import { describe, it, expect } from 'vitest';
import { getStripeConfig, resolvePriceId, PLANS } from '../src/billing/config.js';

const baseEnv = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_START_MONTHLY: 'price_start_m',
  STRIPE_PRICE_PRO_MONTHLY: 'price_pro_m',
  STRIPE_PRICE_MAX_MONTHLY: 'price_max_m',
  STRIPE_PRICE_START_ANNUAL: 'price_start_y',
  STRIPE_PRICE_PRO_ANNUAL: 'price_pro_y',
  STRIPE_PRICE_MAX_ANNUAL: 'price_max_y',
};

describe('getStripeConfig — annual price scaffolding', () => {
  it('exposes both monthly and annual price maps for all plans', () => {
    const cfg = getStripeConfig(baseEnv);
    expect(cfg.ok).toBe(true);
    expect(cfg.priceIds).toEqual({
      start: 'price_start_m',
      pro: 'price_pro_m',
      max: 'price_max_m',
    });
    expect(cfg.priceIdsAnnual).toEqual({
      start: 'price_start_y',
      pro: 'price_pro_y',
      max: 'price_max_y',
    });
  });

  it('annual map is all-null when annual env vars unset', () => {
    const { STRIPE_PRICE_START_ANNUAL: _a, STRIPE_PRICE_PRO_ANNUAL: _b, STRIPE_PRICE_MAX_ANNUAL: _c, ...env } = baseEnv;
    const cfg = getStripeConfig(env);
    expect(cfg.priceIdsAnnual).toEqual({ start: null, pro: null, max: null });
  });
});

describe('resolvePriceId', () => {
  const cfg = getStripeConfig(baseEnv);

  it('returns monthly priceId by default', () => {
    expect(resolvePriceId(cfg, PLANS.START)).toBe('price_start_m');
    expect(resolvePriceId(cfg, PLANS.PRO)).toBe('price_pro_m');
    expect(resolvePriceId(cfg, PLANS.MAX)).toBe('price_max_m');
  });

  it('returns monthly priceId for explicit monthly cycle', () => {
    expect(resolvePriceId(cfg, PLANS.PRO, 'monthly')).toBe('price_pro_m');
  });

  it('returns annual priceId for annual cycle when set', () => {
    expect(resolvePriceId(cfg, PLANS.START, 'annual')).toBe('price_start_y');
    expect(resolvePriceId(cfg, PLANS.PRO, 'annual')).toBe('price_pro_y');
    expect(resolvePriceId(cfg, PLANS.MAX, 'annual')).toBe('price_max_y');
  });

  it('falls back to monthly when annual is unset for that plan', () => {
    const env = { ...baseEnv, STRIPE_PRICE_PRO_ANNUAL: undefined };
    const partialCfg = getStripeConfig(env);
    expect(resolvePriceId(partialCfg, PLANS.PRO, 'annual')).toBe('price_pro_m');
    // others still resolve to annual
    expect(resolvePriceId(partialCfg, PLANS.START, 'annual')).toBe('price_start_y');
  });

  it('returns null for unknown plan', () => {
    expect(resolvePriceId(cfg, 'enterprise', 'monthly')).toBeNull();
    expect(resolvePriceId(cfg, 'enterprise', 'annual')).toBeNull();
  });

  it('returns null when cfg is missing', () => {
    expect(resolvePriceId(null, PLANS.PRO, 'annual')).toBeNull();
    expect(resolvePriceId(undefined, PLANS.PRO, 'monthly')).toBeNull();
  });
});
