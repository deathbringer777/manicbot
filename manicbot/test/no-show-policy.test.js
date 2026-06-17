import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NO_SHOW_POLICY,
  normalizeNoShowPolicy,
  evaluateNoShowPolicy,
  getNoShowPolicy,
  NO_SHOW_POLICY_KEY,
} from '../src/services/policy/noShowPolicy.js';

describe('normalizeNoShowPolicy', () => {
  it('returns neutral defaults for null/garbage input', () => {
    expect(normalizeNoShowPolicy(null)).toEqual(DEFAULT_NO_SHOW_POLICY);
    expect(normalizeNoShowPolicy('nope')).toEqual(DEFAULT_NO_SHOW_POLICY);
    expect(normalizeNoShowPolicy(42)).toEqual(DEFAULT_NO_SHOW_POLICY);
  });

  it('keeps valid values and rejects out-of-domain enums', () => {
    const p = normalizeNoShowPolicy({
      graceMinutes: 30,
      notifyClient: false,
      notifyTone: 'firm',
      afterCount: 3,
      prepayment: 'deposit50',
      penaltyAmount: 100,
      autoAction: 'auto_block',
      lateness: 'strict',
      refund: 'neutral',
    });
    expect(p.graceMinutes).toBe(30);
    expect(p.notifyClient).toBe(false);
    expect(p.notifyTone).toBe('firm');
    expect(p.afterCount).toBe(3);
    expect(p.prepayment).toBe('deposit50');
    expect(p.autoAction).toBe('auto_block');
  });

  it('falls back to defaults on invalid enum/number values', () => {
    const p = normalizeNoShowPolicy({
      notifyTone: 'sarcastic',
      prepayment: 'crypto',
      autoAction: 'nuke',
      graceMinutes: -5,
      penaltyAmount: 'lots',
    });
    expect(p.notifyTone).toBe('neutral');
    expect(p.prepayment).toBe('none');
    expect(p.autoAction).toBe('none');
    expect(p.graceMinutes).toBe(0); // clamped to min, not default
    expect(p.penaltyAmount).toBe(0);
  });

  it('clamps grace minutes into a sane range', () => {
    expect(normalizeNoShowPolicy({ graceMinutes: 9999 }).graceMinutes).toBe(240);
  });
});

describe('evaluateNoShowPolicy', () => {
  it('allows a client with no prior no-shows', () => {
    const r = evaluateNoShowPolicy(null, { noShowCount: 0 });
    expect(r.decision).toBe('allow');
    expect(r.triggered).toBe(false);
  });

  it('warns (no enforcement) when there are no-shows but no escalation configured', () => {
    const r = evaluateNoShowPolicy({ afterCount: 0 }, { noShowCount: 5 });
    expect(r.decision).toBe('warn');
    expect(r.triggered).toBe(false);
  });

  it('does not escalate below the threshold', () => {
    const r = evaluateNoShowPolicy({ afterCount: 3, autoAction: 'auto_block' }, { noShowCount: 2 });
    expect(r.decision).toBe('warn');
    expect(r.triggered).toBe(false);
  });

  it('requires prepayment at/above threshold when configured', () => {
    const r = evaluateNoShowPolicy(
      { afterCount: 2, prepayment: 'deposit50' },
      { noShowCount: 2 },
    );
    expect(r.decision).toBe('require_prepayment');
    expect(r.prepayment).toBe('deposit50');
    expect(r.triggered).toBe(true);
  });

  it('auto_block takes precedence over prepayment', () => {
    const r = evaluateNoShowPolicy(
      { afterCount: 2, prepayment: 'deposit50', autoAction: 'auto_block' },
      { noShowCount: 4 },
    );
    expect(r.decision).toBe('blocked');
  });

  it('require_confirm when set without prepayment', () => {
    const r = evaluateNoShowPolicy(
      { afterCount: 2, autoAction: 'require_confirm' },
      { noShowCount: 3 },
    );
    expect(r.decision).toBe('require_confirm');
  });

  it('surfaces a penalty amount as additive context', () => {
    const r = evaluateNoShowPolicy(
      { afterCount: 1, penaltyAmount: 50 },
      { noShowCount: 1 },
    );
    expect(r.penaltyAmount).toBe(50);
    expect(r.reasons).toContain('penalty');
  });
});

describe('getNoShowPolicy', () => {
  function ctxWith(value) {
    return {
      tenantId: 't1',
      db: { prepare: () => ({ bind: () => ({ first: async () => (value === undefined ? null : { value }) }) }) },
    };
  }

  it('returns defaults when no row exists', async () => {
    expect(await getNoShowPolicy(ctxWith(undefined))).toEqual(DEFAULT_NO_SHOW_POLICY);
  });

  it('returns defaults without a db/tenant', async () => {
    expect(await getNoShowPolicy({})).toEqual(DEFAULT_NO_SHOW_POLICY);
  });

  it('parses + normalizes a stored policy', async () => {
    const stored = JSON.stringify({ graceMinutes: 20, notifyClient: false });
    const p = await getNoShowPolicy(ctxWith(stored));
    expect(p.graceMinutes).toBe(20);
    expect(p.notifyClient).toBe(false);
  });

  it('falls back to defaults on malformed JSON', async () => {
    expect(await getNoShowPolicy(ctxWith('{not json'))).toEqual(DEFAULT_NO_SHOW_POLICY);
  });

  it('exposes the tenant_config key', () => {
    expect(NO_SHOW_POLICY_KEY).toBe('no_show_policy');
  });
});
