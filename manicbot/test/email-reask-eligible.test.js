import { describe, it, expect } from 'vitest';
import { isReaskEligible, EMAIL_REENGAGE_DELAY_SEC } from '../src/services/marketing/contacts.js';

/** Predicate behind the proactive re-ask cron (Scenario C, phaseEmailPrompt). */
describe('isReaskEligible', () => {
  const now = 100_000_000;
  const old = now - EMAIL_REENGAGE_DELAY_SEC - 10; // older than the re-engage delay
  const recent = now - 100;                        // too recent

  it('eligible when no email, never answered, and first contact long ago', () => {
    expect(isReaskEligible({ firstTouchAt: old }, now)).toBe(true);
    expect(isReaskEligible({ registeredAt: old }, now)).toBe(true);
  });

  it('not eligible when first contact is too recent', () => {
    expect(isReaskEligible({ firstTouchAt: recent }, now)).toBe(false);
  });

  it('not eligible without a first-contact anchor (cannot age-gate)', () => {
    expect(isReaskEligible({}, now)).toBe(false);
  });

  it('delegates the email/decline/cap/cooldown gates to shouldAskEmail', () => {
    expect(isReaskEligible({ email: 'a@b.co', firstTouchAt: old }, now)).toBe(false);
    expect(isReaskEligible({ emailOptIn: 0, firstTouchAt: old }, now)).toBe(false);
    expect(isReaskEligible({ emailPromptCount: 3, firstTouchAt: old }, now)).toBe(false);
  });
});
