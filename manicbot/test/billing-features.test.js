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

  // S2 Fix 4 — past_due / unpaid must behave like grace_period (booking-only).
  // Previously these statuses fell through to the "trialing or active" branch
  // and granted FULL plan access, so entitlement depended purely on which
  // webhook arrived first (subscription.updated → past_due vs payment_failed →
  // grace_period). Both must deny premium features.
  it('past_due only allows booking (dunning — no premium access)', () => {
    const ctx = makeCtx({ billingStatus: 'past_due', plan: 'pro' });
    expect(canUse(ctx, 'booking')).toBe(true);
    expect(canUse(ctx, 'ai')).toBe(false);
    expect(canUse(ctx, 'calendar')).toBe(false);
    expect(canUse(ctx, 'support_tickets')).toBe(false);
    expect(canUse(ctx, 'whatsapp')).toBe(false);
  });

  it('unpaid only allows booking (dunning — no premium access)', () => {
    const ctx = makeCtx({ billingStatus: 'unpaid', plan: 'max' });
    expect(canUse(ctx, 'booking')).toBe(true);
    expect(canUse(ctx, 'ai')).toBe(false);
    expect(canUse(ctx, 'calendar')).toBe(false);
    expect(canUse(ctx, 'white_label')).toBe(false);
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

  // Billing-lifecycle PIN: active + max grants the full feature set. This is
  // the comped-MAX shape (active, no sub, no trial) and must keep full access —
  // the warnings/lockout work must not regress entitlement here.
  it('active with max plan grants the full feature set', () => {
    const ctx = makeCtx({ billingStatus: 'active', plan: 'max' });
    expect(canUse(ctx, 'booking')).toBe(true);
    expect(canUse(ctx, 'ai')).toBe(true);
    expect(canUse(ctx, 'calendar')).toBe(true);
    expect(canUse(ctx, 'support_tickets')).toBe(true);
    expect(canUse(ctx, 'white_label')).toBe(true);
    expect(canUse(ctx, 'whatsapp')).toBe(true);
    expect(canUse(ctx, 'instagram')).toBe(true);
  });

  // Billing-lifecycle PIN: once graceEndsAt passes, the bot turns fully OFF —
  // even booking is denied. This is the hard-lockout boundary the warnings
  // phase is counting down to.
  it('grace_period with EXPIRED graceEndsAt blocks everything (hard lockout)', () => {
    const ctx = makeCtx({ billingStatus: 'grace_period', plan: 'pro', graceEndsAt: nowSec() - 3600 });
    expect(canUse(ctx, 'booking')).toBe(false);
    expect(canUse(ctx, 'ai')).toBe(false);
  });

  // Counterpart: grace_period still within its window keeps booking alive.
  it('grace_period within window keeps booking alive', () => {
    const ctx = makeCtx({ billingStatus: 'grace_period', plan: 'pro', graceEndsAt: nowSec() + 3600 });
    expect(canUse(ctx, 'booking')).toBe(true);
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
