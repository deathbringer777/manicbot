/**
 * Tests for src/utils/errorCapture.js — the in-house error monitor.
 *
 * Contract:
 *   - captureError() NEVER throws, even if the D1 binding throws.
 *   - Deduplication: same (error_name + message + path) within 1h
 *     increments count instead of inserting a new row.
 *   - PII stripping: bot tokens, API keys, Bearer tokens, chat IDs are
 *     redacted from stack + message before persistence.
 *   - Severity auto-detection: network → 'warning', startup/security → 'fatal',
 *     default → 'error'. Explicit context.severity wins.
 *   - Bounded payloads: message ≤ 2000, stack ≤ 5000.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captureError, _internals } from '../src/utils/errorCapture.js';

function makeDb({ firstResult = null, runImpl, prepareImpl } = {}) {
  const calls = { prepare: [], bind: [], first: 0, run: 0 };
  const stmt = {
    bind(...args) {
      calls.bind.push(args);
      return stmt;
    },
    async first() {
      calls.first++;
      return firstResult;
    },
    async run() {
      calls.run++;
      if (runImpl) return runImpl();
      return { success: true, meta: { changes: 1 } };
    },
  };
  return {
    prepare(sql) {
      calls.prepare.push(sql);
      if (prepareImpl) return prepareImpl(sql, stmt);
      return stmt;
    },
    __calls: calls,
  };
}

function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    ...overrides,
  };
}

describe('captureError — never throws', () => {
  it('returns silently when env.DB is missing', async () => {
    await expect(captureError({}, new Error('boom'))).resolves.toBeUndefined();
  });

  it('returns silently when db.prepare throws', async () => {
    const env = {
      DB: {
        prepare() {
          throw new Error('binding gone');
        },
      },
    };
    await expect(captureError(env, new Error('boom'))).resolves.toBeUndefined();
  });

  it('returns silently when run() throws', async () => {
    const env = makeEnv({
      DB: makeDb({
        runImpl: () => {
          throw new Error('write failed');
        },
      }),
    });
    await expect(captureError(env, new Error('boom'))).resolves.toBeUndefined();
  });

  it('accepts a non-Error value and does not throw', async () => {
    const env = makeEnv();
    await expect(captureError(env, 'plain string error')).resolves.toBeUndefined();
    await expect(captureError(env, null)).resolves.toBeUndefined();
    await expect(captureError(env, { weird: true })).resolves.toBeUndefined();
  });
});

describe('captureError — deduplication', () => {
  it('inserts a new row when no recent duplicate exists', async () => {
    const db = makeDb({ firstResult: null });
    const env = { DB: db };
    await captureError(env, new Error('boom'), { path: '/x' });
    const sqls = db.__calls.prepare.join('\n');
    expect(sqls).toMatch(/SELECT/i);
    expect(sqls).toMatch(/INSERT INTO error_events/i);
    expect(db.__calls.run).toBe(1);
  });

  it('increments count when same (name+message+path) seen within 1h', async () => {
    const db = makeDb({
      firstResult: { id: 42, count: 3, first_seen_at: 1000, last_seen_at: 2000 },
    });
    const env = { DB: db };
    await captureError(env, new Error('boom'), { path: '/x' });
    const sqls = db.__calls.prepare.join('\n');
    expect(sqls).toMatch(/SELECT/i);
    expect(sqls).toMatch(/UPDATE error_events/i);
    expect(sqls).not.toMatch(/INSERT INTO error_events/i);
    expect(db.__calls.run).toBe(1);
  });

  it('treats a different path as a new error (insert, not update)', async () => {
    // First call returns null (no match for /b), so a fresh INSERT runs
    const db = makeDb({ firstResult: null });
    const env = { DB: db };
    await captureError(env, new Error('boom'), { path: '/b' });
    const sqls = db.__calls.prepare.join('\n');
    expect(sqls).toMatch(/INSERT INTO error_events/i);
  });
});

describe('captureError — PII stripping', () => {
  it('redacts a Telegram bot token from the stack', () => {
    const stack =
      'Error: oops\n  at fetch (https://api.telegram.org/bot1234567890:AAEhBOIzv4cZ_OO0K3eF6abcdef123456789/sendMessage:1:1)';
    const out = _internals.stripPII(stack);
    expect(out).not.toMatch(/1234567890:AAEhBOIzv4cZ/);
    expect(out).toMatch(/\[REDACTED_TG_TOKEN\]/);
  });

  it('redacts Bearer tokens', () => {
    const out = _internals.stripPII('Authorization: Bearer abc123def456ghi789jkl012mno345pqr678');
    expect(out).toMatch(/\[REDACTED_BEARER\]/);
    expect(out).not.toMatch(/abc123def456/);
  });

  it('redacts Stripe-style live/test keys', () => {
    const out = _internals.stripPII('sk_live_abcdefghijklmnopqrstuvwx and sk_test_zyxwvutsrqponmlkjihgfed');
    expect(out).toMatch(/\[REDACTED_API_KEY\]/);
    expect(out).not.toMatch(/sk_live_abcdefghij/);
  });

  it('redacts Resend API keys', () => {
    const out = _internals.stripPII('RESEND key re_abcdef1234567890ABCDEF');
    expect(out).toMatch(/\[REDACTED_API_KEY\]/);
  });
});

describe('captureError — bounds', () => {
  it('truncates message to 2000 chars', () => {
    const huge = 'x'.repeat(5000);
    const out = _internals.bound(huge, 2000);
    expect(out.length).toBe(2000);
  });

  it('truncates stack to 5000 chars', () => {
    const huge = 'x'.repeat(10000);
    const out = _internals.bound(huge, 5000);
    expect(out.length).toBe(5000);
  });
});

describe('captureError — severity detection', () => {
  it('explicit context.severity wins', () => {
    expect(_internals.detectSeverity(new Error('whatever'), { severity: 'fatal' })).toBe('fatal');
  });

  it('network errors → warning', () => {
    expect(_internals.detectSeverity(new Error('fetch failed'), {})).toBe('warning');
    expect(_internals.detectSeverity(new Error('ETIMEDOUT'), {})).toBe('warning');
    expect(_internals.detectSeverity(new Error('connect ECONNREFUSED'), {})).toBe('warning');
    const e = new Error('boom');
    e.name = 'AbortError';
    expect(_internals.detectSeverity(e, {})).toBe('warning');
  });

  it('startup/security errors → fatal', () => {
    expect(_internals.detectSeverity(new Error('[SECURITY] ADMIN_KEY too short'), {})).toBe('fatal');
    expect(_internals.detectSeverity(new Error('boom'), { phase: 'startup' })).toBe('fatal');
  });

  it('default → error', () => {
    expect(_internals.detectSeverity(new Error('some random thing'), {})).toBe('error');
  });
});

describe('captureError — passes context through to INSERT bindings', () => {
  it('binds tenantId, source, severity, path, userId, error_name, message', async () => {
    const db = makeDb({ firstResult: null });
    const env = { DB: db };
    await captureError(env, new Error('boom'), {
      tenantId: 't_demo',
      source: 'worker.fetch',
      path: '/webhook/abc',
      userId: 99,
      severity: 'warning',
      phase: 'reminders',
    });
    // INSERT is the second prepared statement (after SELECT dedupe lookup)
    // Pick the INSERT bind (it includes the source 'worker.fetch'); the
    // SELECT bind also contains 't_demo' (twice) but never the source.
    const bind = db.__calls.bind.find(args => args.includes('worker.fetch'));
    expect(bind).toBeTruthy();
    expect(bind).toEqual(expect.arrayContaining(['t_demo', 'worker.fetch', '/webhook/abc', 'warning']));
    // userId is stringified
    expect(bind).toEqual(expect.arrayContaining(['99']));
  });
});
