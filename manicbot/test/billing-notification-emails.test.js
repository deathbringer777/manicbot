/**
 * #P1-5 (relax.md §5) — Worker-side notification email renderers and
 * helpers. Mirror of the admin-app template tests so the two halves of
 * the codebase stay in lockstep.
 */
import { describe, it, expect } from 'vitest';
import {
  PLAN_ORDER,
  isPlanUpgrade,
  planRank,
  paymentFailedHtml,
  planUpgradeHtml,
} from '../src/billing/notificationEmails.js';

describe('PLAN_ORDER', () => {
  it('exposes the canonical start→pro→max ordering', () => {
    expect(PLAN_ORDER).toEqual(['start', 'pro', 'max']);
  });

  it('planRank maps known plans to 0..2 and unknowns to -1', () => {
    expect(planRank('start')).toBe(0);
    expect(planRank('pro')).toBe(1);
    expect(planRank('max')).toBe(2);
    expect(planRank('enterprise')).toBe(-1);
    expect(planRank(null)).toBe(-1);
    expect(planRank(undefined)).toBe(-1);
  });
});

describe('isPlanUpgrade', () => {
  it('returns true only for strict-up moves', () => {
    expect(isPlanUpgrade('start', 'pro')).toBe(true);
    expect(isPlanUpgrade('pro', 'max')).toBe(true);
    expect(isPlanUpgrade('start', 'max')).toBe(true);
  });

  it('returns false for same-tier moves', () => {
    expect(isPlanUpgrade('start', 'start')).toBe(false);
    expect(isPlanUpgrade('pro', 'pro')).toBe(false);
    expect(isPlanUpgrade('max', 'max')).toBe(false);
  });

  it('returns false for downgrades', () => {
    expect(isPlanUpgrade('max', 'pro')).toBe(false);
    expect(isPlanUpgrade('pro', 'start')).toBe(false);
    expect(isPlanUpgrade('max', 'start')).toBe(false);
  });

  it('returns false when either plan is missing or unknown', () => {
    expect(isPlanUpgrade(null, 'pro')).toBe(false);
    expect(isPlanUpgrade('pro', null)).toBe(false);
    expect(isPlanUpgrade('foo', 'pro')).toBe(false);
    expect(isPlanUpgrade('pro', 'foo')).toBe(false);
  });
});

describe('paymentFailedHtml', () => {
  const baseCopy = {
    heading: 'Heading',
    body: 'Body text',
    amount: 'Amount',
    plan: 'Plan',
    nextStep: 'Next step',
    cta: 'CTA',
    grace: 'Grace text',
  };
  const opts = {
    amountFormatted: '60,00 zł',
    planLabel: 'Pro',
    updateUrl: 'https://manicbot.com/dashboard/billing',
  };

  it('renders valid HTML containing heading + CTA URL', () => {
    const html = paymentFailedHtml(baseCopy, opts, 'Footer');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Heading');
    expect(html).toContain(opts.updateUrl);
    expect(html).toContain('CTA');
    expect(html).toContain('Footer');
  });

  it('shows the formatted amount and plan in the details table', () => {
    const html = paymentFailedHtml(baseCopy, opts, 'F');
    expect(html).toContain('60,00 zł');
    expect(html).toContain('Pro');
  });

  it('uses the grace copy verbatim (mention of 7 days lives in copy)', () => {
    const html = paymentFailedHtml(baseCopy, opts, 'F');
    expect(html).toContain('Grace text');
  });
});

describe('planUpgradeHtml', () => {
  const copy = {
    heading: 'Plan upgraded',
    body: 'Thanks for upgrading',
    from: 'Previous',
    to: 'New',
    cta: 'Go',
    welcome: 'Explore',
  };
  const opts = {
    oldLabel: 'Start',
    newLabel: 'Pro',
    dashboardUrl: 'https://manicbot.com/dashboard',
  };

  it('renders both plan labels and the dashboard URL', () => {
    const html = planUpgradeHtml(copy, opts, 'Footer');
    expect(html).toContain('Start');
    expect(html).toContain('Pro');
    expect(html).toContain(opts.dashboardUrl);
    expect(html).toContain('Footer');
  });

  it('embeds the welcome / explore copy', () => {
    const html = planUpgradeHtml(copy, opts, 'F');
    expect(html).toContain('Explore');
  });
});
