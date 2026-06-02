import { describe, it, expect } from 'vitest';
import { priceIdToPlan } from '../src/billing/config.js';

/**
 * STRIPE-01: a Customer-Portal plan change swaps the subscription price but
 * leaves the original checkout's metadata.plan stale. priceIdToPlan is the
 * authoritative resolver — it maps the live price ID back to its plan via the
 * configured STRIPE_PRICE_* ids so the webhook writes the correct tenants.plan.
 */
describe('priceIdToPlan — authoritative price->plan resolution (STRIPE-01)', () => {
  const cfg = {
    priceIds: { start: 'price_start_m', pro: 'price_pro_m', max: 'price_max_m' },
    priceIdsAnnual: { start: 'price_start_y', pro: 'price_pro_y', max: 'price_max_y' },
  };

  it('maps a monthly price id to its plan', () => {
    expect(priceIdToPlan(cfg, 'price_pro_m')).toBe('pro');
  });

  it('maps an annual price id to its plan (portal upgrade to the yearly Max price)', () => {
    expect(priceIdToPlan(cfg, 'price_max_y')).toBe('max');
  });

  it('returns null for an unconfigured / legacy price id (caller falls back to metadata)', () => {
    expect(priceIdToPlan(cfg, 'price_legacy_oneoff')).toBeNull();
  });

  it('returns null when cfg or priceId is missing (no crash, metadata fallback)', () => {
    expect(priceIdToPlan(null, 'price_pro_m')).toBeNull();
    expect(priceIdToPlan(cfg, null)).toBeNull();
    expect(priceIdToPlan(cfg, undefined)).toBeNull();
  });

  it('ignores null configured ids (annual not set) without false-matching', () => {
    const partial = { priceIds: { start: 'price_start_m', pro: null, max: null }, priceIdsAnnual: {} };
    expect(priceIdToPlan(partial, 'price_start_m')).toBe('start');
    expect(priceIdToPlan(partial, null)).toBeNull();
  });
});
