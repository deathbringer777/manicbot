/**
 * Admin/ops bot — cross-tenant monitoring query shapes + pure helpers.
 * Asserts God-Mode aggregates carry NO tenant_id filter, per-tenant detail
 * queries DO bind the id, parameters are bound (not interpolated), and the
 * MRR/escapeLike helpers behave.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMrr, escapeLike, PLAN_PRICES,
  getPlatformStats, getSignups, getAppts, lookupTenant,
} from '../src/adminbot/monitoring.js';

/** Recording fake D1: routes results by SQL substring, captures all binds. */
function recDb(routes = []) {
  const calls = [];
  const match = (sql) => routes.find((r) => sql.includes(r.match)) || {};
  return {
    calls,
    prepare(sql) {
      return {
        bind: (...params) => {
          calls.push({ sql, params });
          const r = match(sql);
          return {
            first: async () => (r.first !== undefined ? r.first : null),
            all: async () => ({ results: r.all || [] }),
          };
        },
      };
    },
  };
}

describe('pure helpers', () => {
  it('computeMrr sums plan distribution × PLAN_PRICES', () => {
    expect(computeMrr([{ plan: 'start', n: 2 }, { plan: 'pro', n: 3 }, { plan: 'max', n: 1 }]))
      .toBe(2 * PLAN_PRICES.start + 3 * PLAN_PRICES.pro + 1 * PLAN_PRICES.max);
    expect(computeMrr([])).toBe(0);
    expect(computeMrr([{ plan: 'unknown', n: 9 }])).toBe(0);
  });

  it('escapeLike escapes % _ and backslash', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(escapeLike('Glow')).toBe('Glow');
  });
});

describe('getPlatformStats — cross-tenant, is_test excluded', () => {
  it('filters active/trialing/paying and computes MRR; no tenant_id filter', async () => {
    const db = recDb([
      { match: 'active = 1', first: { n: 5 } },
      { match: "'trialing'", first: { n: 2 } },
      { match: "'active' AND is_test", all: [{ plan: 'pro', n: 3 }] },
      { match: 'is_test = 0 AND created_at', first: { n: 1 } },
    ]);
    const s = await getPlatformStats({ db });
    expect(s.activeTenants).toBe(5);
    expect(s.trialing).toBe(2);
    expect(s.mrr).toBe(3 * PLAN_PRICES.pro);
    expect(s.newTenants7d).toBe(1);
    // every aggregate is cross-tenant (no per-tenant scoping)
    for (const c of db.calls) expect(c.sql).not.toContain('tenant_id =');
    // the new-tenants cutoff is a bound epoch NUMBER, not interpolated
    const created = db.calls.find((c) => c.sql.includes('created_at >='));
    expect(typeof created.params[0]).toBe('number');
  });
});

describe('getSignups — rolling windows are bound numbers', () => {
  it('binds epoch cutoffs and filters deleted_at', async () => {
    const db = recDb([{ match: 'FROM users', first: { n: 7 } }, { match: 'FROM tenants', first: { n: 1 } }]);
    await getSignups({ db });
    const userQ = db.calls.filter((c) => c.sql.includes('FROM users'));
    expect(userQ.length).toBe(2);
    for (const c of userQ) {
      expect(c.sql).toContain('deleted_at IS NULL');
      expect(typeof c.params[0]).toBe('number');
    }
  });
});

describe('getAppts — date column, non-cancelled', () => {
  it('binds YYYY-MM-DD for today and filters cancelled = 0', async () => {
    const db = recDb([{ match: 'date = ?', first: { n: 4 } }, { match: 'date >= ?', first: { n: 9 } }, { match: 'created_at >= ?', first: { n: 2 } }]);
    await getAppts({ db });
    const today = db.calls.find((c) => c.sql.includes('date = ?'));
    expect(today.sql).toContain('cancelled = 0');
    expect(today.params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('lookupTenant — parameterized LIKE + per-tenant detail binds id', () => {
  it('binds %query% for name+slug, raw for id, and uses ESCAPE', async () => {
    const db = recDb([
      { match: 'FROM tenants WHERE is_test = 0 AND (name LIKE', all: [{ id: 't1', name: 'Glow', slug: 'glow', plan: 'pro', billing_status: 'active', trial_ends_at: 0, created_at: 0 }] },
      { match: 'FROM bots WHERE tenant_id = ?', all: [{ bot_id: 'b1', bot_username: 'glow_bot', active: 1 }] },
      { match: 'FROM appointments WHERE tenant_id = ?', first: { total: 5, active_apts: 3 } },
    ]);
    const r = await lookupTenant({ db }, 'Glow');
    expect(r.matches.length).toBe(1);
    const lookup = db.calls.find((c) => c.sql.includes('name LIKE'));
    expect(lookup.sql).toContain("ESCAPE '\\'");
    expect(lookup.params[0]).toBe('%Glow%');
    expect(lookup.params[1]).toBe('%Glow%');
    expect(lookup.params[2]).toBe('Glow');
    // per-tenant detail queries DO bind the looked-up id
    const botsQ = db.calls.find((c) => c.sql.includes('FROM bots WHERE tenant_id = ?'));
    expect(botsQ.params[0]).toBe('t1');
    const apptsQ = db.calls.find((c) => c.sql.includes('FROM appointments WHERE tenant_id = ?'));
    expect(apptsQ.params[0]).toBe('t1');
  });
});
