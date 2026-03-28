/**
 * Tests for multi-channel billing/feature gating:
 *  - canUse(ctx, 'whatsapp') / canUse(ctx, 'instagram')
 *  - canSendTemplate (plan quota check)
 *  - getTemplateUsageThisMonth
 *  - PLAN_LIMITS channel assignments
 */
import { describe, it, expect } from 'vitest';
import { canUse } from '../src/billing/features.js';
import { PLAN_LIMITS } from '../src/billing/config.js';
import { canSendTemplate, getTemplateUsageThisMonth, buildReminderComponents } from '../src/channels/whatsapp-templates.js';

// ─── PLAN_LIMITS channel config ───────────────────────────────────────────────

describe('PLAN_LIMITS channel configuration', () => {
  it('start plan has only telegram', () => {
    expect(PLAN_LIMITS.start.channels).toEqual(['telegram']);
    expect(PLAN_LIMITS.start.wa_templates_monthly).toBe(0);
  });

  it('pro plan includes whatsapp and instagram', () => {
    expect(PLAN_LIMITS.pro.channels).toContain('telegram');
    expect(PLAN_LIMITS.pro.channels).toContain('whatsapp');
    expect(PLAN_LIMITS.pro.channels).toContain('instagram');
    expect(PLAN_LIMITS.pro.wa_templates_monthly).toBe(500);
  });

  it('studio plan includes all channels with high template limit', () => {
    expect(PLAN_LIMITS.studio.channels).toContain('instagram');
    expect(PLAN_LIMITS.studio.wa_templates_monthly).toBe(5000);
  });
});

// ─── canUse — channel features ────────────────────────────────────────────────

describe('canUse — whatsapp / instagram feature gating', () => {
  it('start plan denies whatsapp', () => {
    const ctx = { tenant: { billingStatus: 'active', plan: 'start' } };
    expect(canUse(ctx, 'whatsapp')).toBe(false);
    expect(canUse(ctx, 'instagram')).toBe(false);
  });

  it('pro plan allows whatsapp and instagram', () => {
    const ctx = { tenant: { billingStatus: 'active', plan: 'pro' } };
    expect(canUse(ctx, 'whatsapp')).toBe(true);
    expect(canUse(ctx, 'instagram')).toBe(true);
  });

  it('studio plan allows whatsapp and instagram', () => {
    const ctx = { tenant: { billingStatus: 'active', plan: 'studio' } };
    expect(canUse(ctx, 'whatsapp')).toBe(true);
    expect(canUse(ctx, 'instagram')).toBe(true);
  });

  it('grace period blocks whatsapp even on pro', () => {
    const ctx = { tenant: { billingStatus: 'grace_period', plan: 'pro' } };
    expect(canUse(ctx, 'whatsapp')).toBe(false);
    expect(canUse(ctx, 'instagram')).toBe(false);
  });

  it('inactive tenant blocks whatsapp', () => {
    const ctx = { tenant: { billingStatus: 'inactive', plan: 'pro' } };
    expect(canUse(ctx, 'whatsapp')).toBe(false);
  });

  it('trialing pro tenant allows whatsapp', () => {
    const ctx = { tenant: { billingStatus: 'trialing', plan: 'pro' } };
    expect(canUse(ctx, 'whatsapp')).toBe(true);
  });

  it('legacy mode (no tenant) allows whatsapp', () => {
    expect(canUse({ tenant: null }, 'whatsapp')).toBe(true);
  });
});

// ─── canSendTemplate ──────────────────────────────────────────────────────────

describe('canSendTemplate', () => {
  it('returns true in legacy mode (no tenant)', async () => {
    const ctx = { tenant: null };
    expect(await canSendTemplate(ctx)).toBe(true);
  });

  it('returns false for start plan (0 templates)', async () => {
    const ctx = {
      tenant: { plan: 'start' },
      db: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ cnt: 0 }] }) }) }) },
      tenantId: 't_test',
    };
    expect(await canSendTemplate(ctx)).toBe(false);
  });

  it('returns true when usage < limit for pro plan', async () => {
    const ctx = {
      tenant: { plan: 'pro' },
      db: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ cnt: 100 }] }) }) }) },
      tenantId: 't_pro',
    };
    expect(await canSendTemplate(ctx)).toBe(true); // 100 < 500
  });

  it('returns false when usage >= limit', async () => {
    const ctx = {
      tenant: { plan: 'pro' },
      db: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ cnt: 500 }] }) }) }) },
      tenantId: 't_pro_full',
    };
    expect(await canSendTemplate(ctx)).toBe(false); // 500 >= 500
  });
});

// ─── getTemplateUsageThisMonth ────────────────────────────────────────────────

describe('getTemplateUsageThisMonth', () => {
  it('returns 0 when db is absent', async () => {
    expect(await getTemplateUsageThisMonth({ db: null, tenantId: 't_x' })).toBe(0);
    expect(await getTemplateUsageThisMonth({ db: null })).toBe(0);
  });

  it('returns count from db', async () => {
    const ctx = {
      tenantId: 't_x',
      db: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [{ cnt: 42 }] }) }),
        }),
      },
    };
    expect(await getTemplateUsageThisMonth(ctx)).toBe(42);
  });

  it('returns 0 when db returns empty results', async () => {
    const ctx = {
      tenantId: 't_x',
      db: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
        }),
      },
    };
    expect(await getTemplateUsageThisMonth(ctx)).toBe(0);
  });
});

// ─── buildReminderComponents ──────────────────────────────────────────────────

describe('buildReminderComponents', () => {
  it('builds correct WA template components', () => {
    const vars = { svc: 'Classic Manicure', dt: '2 апреля в 14:00', addr: 'ul. Nowy Świat 15' };
    const components = buildReminderComponents(vars);
    expect(components).toHaveLength(1);
    expect(components[0].type).toBe('body');
    expect(components[0].parameters).toHaveLength(3);
    expect(components[0].parameters[0]).toEqual({ type: 'text', text: 'Classic Manicure' });
    expect(components[0].parameters[1]).toEqual({ type: 'text', text: '2 апреля в 14:00' });
    expect(components[0].parameters[2]).toEqual({ type: 'text', text: 'ul. Nowy Świat 15' });
  });

  it('handles missing vars gracefully', () => {
    const components = buildReminderComponents({});
    expect(components[0].parameters[0]).toEqual({ type: 'text', text: '' });
  });
});
