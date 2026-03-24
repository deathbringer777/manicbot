import { describe, it, expect } from 'vitest';
import { canUse, getMastersLimit, isInactive, isGracePeriod, isTrialing, graceRemainingDays, trialRemainingDays } from '../src/billing/features.js';
import { nowSec } from '../src/utils/time.js';

function makeCtx(tenant) {
  return { tenant };
}

describe('canUse — feature gating', () => {
  it('legacy mode (no tenant) allows everything', () => {
    const ctx = makeCtx(null);
    expect(canUse(ctx, 'booking')).toBe(true);
    expect(canUse(ctx, 'ai')).toBe(true);
    expect(canUse(ctx, 'calendar')).toBe(true);
  });

  it('inactive tenant blocks everything', () => {
    const ctx = makeCtx({ billingStatus: 'inactive', plan: 'pro' });
    expect(canUse(ctx, 'booking')).toBe(false);
    expect(canUse(ctx, 'ai')).toBe(false);
  });

  it('canceled tenant blocks everything', () => {
    const ctx = makeCtx({ billingStatus: 'canceled', plan: 'pro' });
    expect(canUse(ctx, 'booking')).toBe(false);
  });

  it('grace period only allows booking', () => {
    const ctx = makeCtx({ billingStatus: 'grace_period', plan: 'pro' });
    expect(canUse(ctx, 'booking')).toBe(true);
    expect(canUse(ctx, 'ai')).toBe(false);
    expect(canUse(ctx, 'calendar')).toBe(false);
  });

  it('trialing with pro plan allows AI', () => {
    const ctx = makeCtx({ billingStatus: 'trialing', plan: 'pro' });
    expect(canUse(ctx, 'ai')).toBe(true);
    expect(canUse(ctx, 'booking')).toBe(true);
  });

  it('active with start plan denies AI', () => {
    const ctx = makeCtx({ billingStatus: 'active', plan: 'start' });
    expect(canUse(ctx, 'ai')).toBe(false);
    expect(canUse(ctx, 'booking')).toBe(true);
  });

  it('unknown feature returns false', () => {
    const ctx = makeCtx({ billingStatus: 'active', plan: 'pro' });
    expect(canUse(ctx, 'unknown_feature')).toBe(false);
  });

  it('unknown plan falls back to start limits', () => {
    const ctx = makeCtx({ billingStatus: 'active', plan: 'mystery_plan' });
    expect(canUse(ctx, 'ai')).toBe(false);
  });
});

describe('getMastersLimit', () => {
  it('legacy mode returns Infinity', () => {
    expect(getMastersLimit({ tenant: null })).toBe(Infinity);
  });

  it('start plan has limited masters', () => {
    const limit = getMastersLimit(makeCtx({ plan: 'start' }));
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(100);
  });

  it('pro plan has more masters than start', () => {
    const startLimit = getMastersLimit(makeCtx({ plan: 'start' }));
    const proLimit = getMastersLimit(makeCtx({ plan: 'pro' }));
    expect(proLimit).toBeGreaterThanOrEqual(startLimit);
  });
});

describe('isInactive', () => {
  it('returns false for legacy mode', () => {
    expect(isInactive({ tenant: null })).toBe(false);
  });

  it('returns true for inactive', () => {
    expect(isInactive(makeCtx({ billingStatus: 'inactive' }))).toBe(true);
  });

  it('returns true for canceled', () => {
    expect(isInactive(makeCtx({ billingStatus: 'canceled' }))).toBe(true);
  });

  it('returns false for active', () => {
    expect(isInactive(makeCtx({ billingStatus: 'active' }))).toBe(false);
  });

  it('returns false for trialing', () => {
    expect(isInactive(makeCtx({ billingStatus: 'trialing' }))).toBe(false);
  });
});

describe('isGracePeriod', () => {
  it('returns true only for grace_period', () => {
    expect(isGracePeriod(makeCtx({ billingStatus: 'grace_period' }))).toBe(true);
    expect(isGracePeriod(makeCtx({ billingStatus: 'active' }))).toBe(false);
    expect(isGracePeriod({ tenant: null })).toBe(false);
  });
});

describe('isTrialing', () => {
  it('returns true only for trialing', () => {
    expect(isTrialing(makeCtx({ billingStatus: 'trialing' }))).toBe(true);
    expect(isTrialing(makeCtx({ billingStatus: 'active' }))).toBe(false);
    expect(isTrialing({ tenant: null })).toBe(false);
  });
});

describe('graceRemainingDays', () => {
  it('returns 0 when not in grace period', () => {
    expect(graceRemainingDays(makeCtx({ billingStatus: 'active' }))).toBe(0);
  });

  it('returns 0 when graceEndsAt is null', () => {
    expect(graceRemainingDays(makeCtx({ billingStatus: 'grace_period', graceEndsAt: null }))).toBe(0);
  });

  it('returns positive days when grace is active', () => {
    const future = nowSec() + 3 * 86400;
    const days = graceRemainingDays(makeCtx({ billingStatus: 'grace_period', graceEndsAt: future }));
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(4);
  });

  it('returns 0 when grace has expired', () => {
    const past = nowSec() - 86400;
    expect(graceRemainingDays(makeCtx({ billingStatus: 'grace_period', graceEndsAt: past }))).toBe(0);
  });
});

describe('trialRemainingDays', () => {
  it('returns 0 when not trialing', () => {
    expect(trialRemainingDays(makeCtx({ billingStatus: 'active' }))).toBe(0);
  });

  it('returns 0 when trialEndsAt is null', () => {
    expect(trialRemainingDays(makeCtx({ billingStatus: 'trialing', trialEndsAt: null }))).toBe(0);
  });

  it('returns positive days when trial is active', () => {
    const future = nowSec() + 5 * 86400;
    const days = trialRemainingDays(makeCtx({ billingStatus: 'trialing', trialEndsAt: future }));
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(6);
  });

  it('returns 0 when trial has expired', () => {
    const past = nowSec() - 86400;
    expect(trialRemainingDays(makeCtx({ billingStatus: 'trialing', trialEndsAt: past }))).toBe(0);
  });
});
