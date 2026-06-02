/**
 * #B-1 — canUse entitlement must be an ALLOWLIST of paying statuses.
 *
 * The original logic blocked {inactive, canceled} and made
 * {grace_period, past_due, unpaid} booking-only, then FELL THROUGH to the
 * "trialing or active" plan-check for everything else. Stripe also emits
 * `incomplete`, `incomplete_expired` and `paused` — none of which represent a
 * paid subscription — so those (and any unmapped/typo status) silently got
 * FULL plan access for free. Fix: only `active`/`trialing` may reach the plan
 * checks; anything else is denied.
 */
import { describe, it, expect } from 'vitest';
import { canUse } from '../src/billing/features.js';

const t = (billingStatus, plan = 'pro') => ({ tenant: { billingStatus, plan } });

describe('#B-1 — canUse entitlement allowlist', () => {
  it('lets active/trialing reach the plan check', () => {
    expect(canUse(t('active'), 'booking')).toBe(true);
    expect(canUse(t('trialing'), 'booking')).toBe(true);
  });

  it('DENIES all features for incomplete / incomplete_expired / paused (was: free full access)', () => {
    for (const s of ['incomplete', 'incomplete_expired', 'paused']) {
      expect(canUse(t(s), 'booking')).toBe(false);
      expect(canUse(t(s), 'ai')).toBe(false);
    }
  });

  it('denies an unmapped / typo status by default', () => {
    expect(canUse(t('frobnicate'), 'booking')).toBe(false);
  });

  it('preserves existing behaviour (inactive/canceled blocked; payment-trouble booking-only)', () => {
    expect(canUse(t('inactive'), 'booking')).toBe(false);
    expect(canUse(t('canceled'), 'booking')).toBe(false);
    expect(canUse(t('past_due'), 'booking')).toBe(true);
    expect(canUse(t('past_due'), 'ai')).toBe(false);
    expect(canUse(t('grace_period'), 'booking')).toBe(true);
  });

  it('legacy mode (no tenant) is unaffected', () => {
    expect(canUse({}, 'ai')).toBe(true);
  });
});
