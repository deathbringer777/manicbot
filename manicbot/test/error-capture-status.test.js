/**
 * Status-lifecycle tests for src/utils/errorCapture.js (migration 0057).
 *
 * Covers:
 *   - regression: a new fire on a `resolved` issue flips status back to `open`
 *     and clears resolved_at / resolved_by.
 *   - ignored: bump count/last_seen silently, never auto-reopen.
 *   - snoozed (active): bump silently, do not reopen.
 *   - snoozed (expired): reopen automatically.
 *   - severity escalation: stored severity rises to max(prev, incoming).
 *   - 0057 columns are bound on INSERT (status, environment, error_type,
 *     title, url, method, request_id, sample_json).
 */
import { describe, it, expect, vi } from 'vitest';
import { captureError, _internals } from '../src/utils/errorCapture.js';

function makeDb({ firstResult = null } = {}) {
  const calls = { prepare: [], bind: [], run: 0 };
  const stmt = {
    bind(...args) {
      calls.bind.push(args);
      return stmt;
    },
    async first() {
      return firstResult;
    },
    async run() {
      calls.run++;
      return { success: true };
    },
  };
  return {
    prepare(sql) {
      calls.prepare.push(sql);
      return stmt;
    },
    __calls: calls,
  };
}

function lastBindFor(db, sqlMatcher) {
  for (let i = db.__calls.prepare.length - 1; i >= 0; i--) {
    if (sqlMatcher.test(db.__calls.prepare[i])) return db.__calls.bind[i];
  }
  return null;
}

describe('captureError — status lifecycle', () => {
  it('regression: resolved → fire flips to open and clears resolved_at/by', async () => {
    const db = makeDb({
      firstResult: { id: 7, status: 'resolved', count: 5, snooze_until: null, severity: 'error' },
    });
    await captureError({ DB: db }, new Error('regressed bug'), { path: '/x' });
    const upd = lastBindFor(db, /UPDATE error_events/);
    expect(upd).toBeTruthy();
    // clearResolution flags are positions 4 and 5 in the bind (after nowSec,
    // mergedSeverity, nextStatus). Easiest to assert the resulting status is 'open'.
    expect(upd).toContain('open');
    // clearResolution and clearSnooze are encoded as 1/0; we expect clearResolution=1.
    expect(upd.filter((v) => v === 1).length).toBeGreaterThanOrEqual(1);
  });

  it('ignored: bump count but keep status ignored, no clear flags', async () => {
    const db = makeDb({
      firstResult: { id: 9, status: 'ignored', count: 12, snooze_until: null, severity: 'warning' },
    });
    await captureError({ DB: db }, new Error('noisy'), { path: '/x' });
    const upd = lastBindFor(db, /UPDATE error_events/);
    expect(upd).toBeTruthy();
    expect(upd).toContain('ignored');
    expect(upd).not.toContain('open');
  });

  it('snoozed active: stays snoozed, count bumped', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const db = makeDb({
      firstResult: { id: 11, status: 'snoozed', count: 2, snooze_until: future, severity: 'error' },
    });
    await captureError({ DB: db }, new Error('still snoozed'), {});
    const upd = lastBindFor(db, /UPDATE error_events/);
    expect(upd).toContain('snoozed');
    expect(upd).not.toContain('open');
  });

  it('snoozed expired: auto-reopens', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const db = makeDb({
      firstResult: { id: 13, status: 'snoozed', count: 2, snooze_until: past, severity: 'error' },
    });
    await captureError({ DB: db }, new Error('back from snooze'), {});
    const upd = lastBindFor(db, /UPDATE error_events/);
    expect(upd).toContain('open');
  });

  it('open: stays open, count bumped (back-compat with 0056 dedup path)', async () => {
    const db = makeDb({ firstResult: { id: 1, status: 'open', count: 3 } });
    await captureError({ DB: db }, new Error('again'), { path: '/x' });
    const sqls = db.__calls.prepare.join('\n');
    expect(sqls).toMatch(/UPDATE error_events/);
    expect(sqls).not.toMatch(/INSERT INTO error_events/);
  });
});

describe('captureError — severity escalation', () => {
  it('upgrades stored severity from warning to error on the next fire', async () => {
    const db = makeDb({
      firstResult: { id: 1, status: 'open', count: 1, snooze_until: null, severity: 'warning' },
    });
    await captureError({ DB: db }, new Error('boom'), {}); // detectSeverity → 'error'
    const upd = lastBindFor(db, /UPDATE error_events/);
    expect(upd).toContain('error');
  });

  it('does not downgrade fatal to error', async () => {
    const db = makeDb({
      firstResult: { id: 1, status: 'open', count: 1, snooze_until: null, severity: 'fatal' },
    });
    await captureError({ DB: db }, new Error('boom'), {});
    const upd = lastBindFor(db, /UPDATE error_events/);
    expect(upd).toContain('fatal');
  });
});

describe('captureError — 0057 INSERT columns', () => {
  it('binds status=open, environment, error_type, title, url, method, request_id, sample_json', async () => {
    const db = makeDb({ firstResult: null });
    await captureError(
      { DB: db, ENVIRONMENT: 'preview', RELEASE: 'sha-abc' },
      new TypeError('cannot read x of undefined'),
      {
        tenantId: 't_demo',
        source: 'worker.fetch',
        path: '/webhook/abc',
        userId: 99,
        url: 'https://manicbot.com/webhook/abc?foo=1',
        method: 'POST',
        requestId: 'ray-12345',
        sample: { body: { type: 'message' } },
      },
    );
    const ins = lastBindFor(db, /INSERT INTO error_events/);
    expect(ins).toBeTruthy();
    // Environment + release injected from env.
    expect(ins).toContain('preview');
    expect(ins).toContain('sha-abc');
    // error_type comes from Error.name.
    expect(ins).toContain('TypeError');
    // url, method, requestId are bound through.
    expect(ins).toContain('https://manicbot.com/webhook/abc?foo=1');
    expect(ins).toContain('POST');
    expect(ins).toContain('ray-12345');
    // sample_json is stringified.
    const sampleArg = ins.find(
      (v) => typeof v === 'string' && v.includes('"type":"message"'),
    );
    expect(sampleArg).toBeTruthy();
    // title is bounded to MAX_TITLE_LEN (200) — for this short message, equals message.
    expect(ins).toContain('cannot read x of undefined');
  });

  it('defaults environment to production when env.ENVIRONMENT is unset', async () => {
    const db = makeDb({ firstResult: null });
    await captureError({ DB: db }, new Error('boom'), {});
    const ins = lastBindFor(db, /INSERT INTO error_events/);
    expect(ins).toContain('production');
  });

  it('redacts PII from sample_json', async () => {
    const db = makeDb({ firstResult: null });
    await captureError({ DB: db }, new Error('boom'), {
      sample: { authHeader: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    });
    const ins = lastBindFor(db, /INSERT INTO error_events/);
    const sampleArg = ins.find((v) => typeof v === 'string' && v.startsWith('{"authHeader'));
    expect(sampleArg).toBeTruthy();
    expect(sampleArg).toMatch(/\[REDACTED_BEARER\]/);
    expect(sampleArg).not.toMatch(/abcdefghijklmnopqrstuvwxyz/);
  });
});

describe('captureError — internals.maxSeverity', () => {
  it('returns the higher-ranked severity', () => {
    const { maxSeverity } = _internals;
    expect(maxSeverity('warning', 'error')).toBe('error');
    expect(maxSeverity('error', 'fatal')).toBe('fatal');
    expect(maxSeverity('fatal', 'warning')).toBe('fatal');
    expect(maxSeverity('error', 'error')).toBe('error');
    expect(maxSeverity('info', 'warning')).toBe('warning');
  });
});
