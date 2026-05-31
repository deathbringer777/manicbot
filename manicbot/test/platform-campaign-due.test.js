/**
 * platformCampaigns — pure due-engine + helpers (no DB, clock injected).
 *
 * `isCampaignDueForTenant(campaign, tenant, now)` is the heart of the
 * dispatch: given a campaign row, the tenant row, and an injected `now`
 * ({year,month,day,hour,minute,epochSec} in platform tz), it returns
 * { due, occurrenceKey }. occurrenceKey is the idempotency bucket — once a
 * delivery exists for it, the campaign never re-fires for that bucket.
 */

import { describe, it, expect } from 'vitest';
import {
  pad2,
  weekdayOf,
  previousMonth,
  isoWeekKey,
  atOrAfter,
  normalizeBillingStatus,
  pickRenewalAnchor,
  audienceMatchesTenant,
  isCampaignDueForTenant,
} from '../src/services/platformCampaigns.js';

function nowAt(year, month, day, hour, minute) {
  return {
    year, month, day, hour, minute,
    epochSec: Math.floor(Date.UTC(year, month - 1, day, hour, minute) / 1000),
  };
}

// Build an epoch (sec) for a UTC noon on the given date — used as a billing
// anchor. Noon UTC stays the same calendar day in Europe/Warsaw year-round.
function anchorEpoch(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0) / 1000);
}

describe('pure helpers', () => {
  it('pad2', () => {
    expect(pad2(1)).toBe('01');
    expect(pad2(12)).toBe('12');
  });

  it('weekdayOf (0=Sun..6=Sat, UTC)', () => {
    // 2026-06-01 is a Monday.
    expect(weekdayOf(2026, 6, 1)).toBe(1);
    // 2026-05-31 is a Sunday.
    expect(weekdayOf(2026, 5, 31)).toBe(0);
  });

  it('previousMonth handles Jan→Dec rollover', () => {
    expect(previousMonth(2026, 5)).toEqual({ year: 2026, month: 4 });
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  it('atOrAfter compares wall-clock hour:minute', () => {
    expect(atOrAfter({ hour: 7, minute: 0 }, 7, 0)).toBe(true);
    expect(atOrAfter({ hour: 6, minute: 59 }, 7, 0)).toBe(false);
    expect(atOrAfter({ hour: 8, minute: 0 }, 7, 0)).toBe(true);
    expect(atOrAfter({ hour: 7, minute: 5 }, 7, 0)).toBe(true);
    expect(atOrAfter({ hour: 7, minute: 0 }, 7, 30)).toBe(false);
  });

  it('normalizeBillingStatus maps D1 values to the admin-app enum', () => {
    expect(normalizeBillingStatus('grace_period')).toBe('grace');
    expect(normalizeBillingStatus('inactive')).toBe('expired');
    expect(normalizeBillingStatus('active')).toBe('active');
    expect(normalizeBillingStatus('trialing')).toBe('trialing');
  });
});

describe('audienceMatchesTenant', () => {
  const tenant = { plan: 'pro', billing_status: 'active' };

  it('null / missing audience matches everyone (singleton automations)', () => {
    expect(audienceMatchesTenant(null, tenant)).toBe(true);
    expect(audienceMatchesTenant(undefined, tenant)).toBe(true);
    expect(audienceMatchesTenant('not json', tenant)).toBe(true);
  });

  it('scope=all matches everyone', () => {
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'all' }), tenant)).toBe(true);
  });

  it('scope=by_plan matches only listed plans', () => {
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'by_plan', plans: ['pro', 'max'] }), tenant)).toBe(true);
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'by_plan', plans: ['start'] }), tenant)).toBe(false);
  });

  it('by_plan defaults a missing tenant.plan to start', () => {
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'by_plan', plans: ['start'] }), { billing_status: 'active' })).toBe(true);
  });

  it('scope=by_billing_status normalizes D1 status (grace_period→grace)', () => {
    const grace = { plan: 'pro', billing_status: 'grace_period' };
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'by_billing_status', statuses: ['grace'] }), grace)).toBe(true);
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'by_billing_status', statuses: ['active'] }), grace)).toBe(false);
    const inactive = { plan: 'pro', billing_status: 'inactive' };
    expect(audienceMatchesTenant(JSON.stringify({ scope: 'by_billing_status', statuses: ['expired'] }), inactive)).toBe(true);
  });
});

describe('pickRenewalAnchor', () => {
  it('active → current_period_end', () => {
    expect(pickRenewalAnchor({ billing_status: 'active', current_period_end: 123 })).toBe(123);
  });
  it('active + cancel_at_period_end → still current_period_end (copy differs, anchor same)', () => {
    expect(pickRenewalAnchor({ billing_status: 'active', current_period_end: 123, cancel_at_period_end: 1 })).toBe(123);
  });
  it('grace_period → grace_ends_at', () => {
    expect(pickRenewalAnchor({ billing_status: 'grace_period', grace_ends_at: 456 })).toBe(456);
  });
  it('trialing → null (Stripe owns trial-end)', () => {
    expect(pickRenewalAnchor({ billing_status: 'trialing', trial_ends_at: 789 })).toBeNull();
  });
  it('inactive / no anchor → null', () => {
    expect(pickRenewalAnchor({ billing_status: 'inactive' })).toBeNull();
    expect(pickRenewalAnchor({ billing_status: 'active' })).toBeNull();
  });
});

describe('isCampaignDueForTenant — monthly_report', () => {
  const camp = {
    kind: 'monthly_report',
    recurrence_json: JSON.stringify({ freq: 'monthly', day: 1, hour: 7, minute: 0 }),
  };
  const tenant = { plan: 'pro', billing_status: 'active' };

  it('fires on the 1st at/after 07:00, occurrence = previous month', () => {
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 5, 1, 7, 0)))
      .toEqual({ due: true, occurrenceKey: '2026-04' });
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 5, 1, 8, 30)))
      .toEqual({ due: true, occurrenceKey: '2026-04' });
  });

  it('Jan 1 reports the previous December', () => {
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 1, 1, 7, 0)))
      .toEqual({ due: true, occurrenceKey: '2025-12' });
  });

  it('not due before 07:00 or on any day but the 1st', () => {
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 5, 1, 6, 59)).due).toBe(false);
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 5, 2, 7, 0)).due).toBe(false);
  });
});

describe('isCampaignDueForTenant — announcement schedules', () => {
  const tenant = { plan: 'pro', billing_status: 'active' };

  it('now → due immediately, occurrence "once"', () => {
    const camp = { kind: 'announcement', schedule_kind: 'now' };
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 5, 15, 3, 0)))
      .toEqual({ due: true, occurrenceKey: 'once' });
  });

  it('once → due only at/after scheduled_at, occurrence "once"', () => {
    const t = nowAt(2026, 5, 15, 12, 0);
    const before = { kind: 'announcement', schedule_kind: 'once', scheduled_at: t.epochSec + 3600 };
    const after = { kind: 'announcement', schedule_kind: 'once', scheduled_at: t.epochSec - 3600 };
    expect(isCampaignDueForTenant(before, tenant, t).due).toBe(false);
    expect(isCampaignDueForTenant(after, tenant, t)).toEqual({ due: true, occurrenceKey: 'once' });
  });

  it('recurring daily → one occurrence per calendar day, gated by time', () => {
    const camp = { kind: 'announcement', schedule_kind: 'recurring', recurrence_json: JSON.stringify({ freq: 'daily', hour: 9, minute: 0 }) };
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 5, 9, 0)))
      .toEqual({ due: true, occurrenceKey: '2026-06-05' });
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 5, 8, 59)).due).toBe(false);
  });

  it('recurring weekly → only on the matching weekday, ISO-week occurrence', () => {
    // 2026-06-01 is Monday (weekday 1).
    const wd = weekdayOf(2026, 6, 1);
    const camp = { kind: 'announcement', schedule_kind: 'recurring', recurrence_json: JSON.stringify({ freq: 'weekly', weekday: wd, hour: 10, minute: 0 }) };
    const due = isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 1, 10, 0));
    expect(due.due).toBe(true);
    expect(due.occurrenceKey).toBe(isoWeekKey(2026, 6, 1));
    // Tuesday (weekday+1) → not due.
    const other = { kind: 'announcement', schedule_kind: 'recurring', recurrence_json: JSON.stringify({ freq: 'weekly', weekday: (wd + 1) % 7, hour: 10, minute: 0 }) };
    expect(isCampaignDueForTenant(other, tenant, nowAt(2026, 6, 1, 10, 0)).due).toBe(false);
  });

  it('recurring monthly → only on the matching day-of-month', () => {
    const camp = { kind: 'announcement', schedule_kind: 'recurring', recurrence_json: JSON.stringify({ freq: 'monthly', day: 15, hour: 12, minute: 0 }) };
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 15, 12, 0)))
      .toEqual({ due: true, occurrenceKey: '2026-06' });
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 14, 12, 0)).due).toBe(false);
  });
});

describe('isCampaignDueForTenant — subscription_reminder', () => {
  const camp = {
    kind: 'subscription_reminder',
    recurrence_json: JSON.stringify({ freq: 'daily', hour: 9, minute: 0, daysBefore: 3 }),
  };

  it('fires exactly N days before the renewal anchor, at/after the hour', () => {
    const tenant = { billing_status: 'active', current_period_end: anchorEpoch(2026, 6, 4) };
    // now = 2026-06-01 09:00 → 3 days before 2026-06-04.
    const due = isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 1, 9, 0));
    expect(due.due).toBe(true);
    expect(due.occurrenceKey).toBe(String(anchorEpoch(2026, 6, 4)));
  });

  it('not due at N±1 days or before the hour', () => {
    const tenant = { billing_status: 'active', current_period_end: anchorEpoch(2026, 6, 4) };
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 2, 9, 0)).due).toBe(false); // 2 days
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 5, 31, 9, 0)).due).toBe(false); // 4 days
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 1, 8, 59)).due).toBe(false); // before 09:00
  });

  it('trialing tenant is not reminded (Stripe owns trial-end)', () => {
    const tenant = { billing_status: 'trialing', trial_ends_at: anchorEpoch(2026, 6, 4) };
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 1, 9, 0)).due).toBe(false);
  });

  it('grace_period uses grace_ends_at as the anchor', () => {
    const tenant = { billing_status: 'grace_period', grace_ends_at: anchorEpoch(2026, 6, 4) };
    expect(isCampaignDueForTenant(camp, tenant, nowAt(2026, 6, 1, 9, 0)).due).toBe(true);
  });
});

describe('isCampaignDueForTenant — guards', () => {
  it('unknown kind → not due', () => {
    expect(isCampaignDueForTenant({ kind: 'mystery' }, {}, nowAt(2026, 6, 1, 9, 0)))
      .toEqual({ due: false, occurrenceKey: null });
  });
});
