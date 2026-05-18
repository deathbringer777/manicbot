/**
 * Pins the PR 3 contract on `captureError()`:
 *   - When `context.errorType` is supplied, it's stored on the
 *     `error_events.error_type` column instead of the raw Error class name.
 *   - When omitted, falls back to Error.name (backwards-compat).
 *   - Slug is bounded to 64 chars (matches DB column limit).
 *   - The IG-specific slugs from `channels/error-types.js` are intentionally
 *     short enough to fit (sanity bound — guards future slug additions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

import { captureError } from '../src/utils/errorCapture.js';
import { CHANNEL_ERROR_TYPE, IG_ALL_ERROR_TYPES } from '../src/channels/error-types.js';

function makeEnv() {
  const inserts = [];
  const updates = [];
  return {
    ENVIRONMENT: 'test',
    DB: {
      prepare(sql) {
        return {
          _sql: sql,
          bind(...params) {
            return {
              _params: params,
              async first() {
                if (sql.includes('SELECT id, status, count')) return null;
                return null;
              },
              async run() {
                if (sql.startsWith('INSERT INTO error_events')) inserts.push({ sql, params });
                else if (sql.startsWith('UPDATE error_events')) updates.push({ sql, params });
                return { success: true };
              },
            };
          },
        };
      },
    },
    _inserts: inserts,
    _updates: updates,
  };
}

describe('captureError — context.errorType (PR 3)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('stores the supplied errorType slug on a new INSERT', async () => {
    const env = makeEnv();
    await captureError(env, new Error('IG token rejected by Graph'), {
      source: 'cron.channel_health',
      tenantId: 't_real',
      errorType: CHANNEL_ERROR_TYPE.IG_TOKEN_REJECTED,
      severity: 'fatal',
    });
    expect(env._inserts).toHaveLength(1);
    const { params } = env._inserts[0];
    // INSERT binds parameters in the order they appear in the SQL. The
    // error_type column is positioned per the 0057 migration. Find by value
    // rather than index to stay resilient to ordering tweaks.
    expect(params).toContain('channel.ig.token_rejected');
  });

  it('falls back to Error.name when errorType is omitted', async () => {
    const env = makeEnv();
    class CustomError extends Error { constructor(msg) { super(msg); this.name = 'CustomError'; } }
    await captureError(env, new CustomError('boom'), {
      source: 'test',
      tenantId: 't_real',
    });
    expect(env._inserts).toHaveLength(1);
    expect(env._inserts[0].params).toContain('CustomError');
  });

  it('truncates an oversized errorType to 64 chars (matches DB column)', async () => {
    const env = makeEnv();
    const longSlug = 'channel.ig.' + 'x'.repeat(200);
    await captureError(env, new Error('y'), {
      source: 'test', tenantId: 't_real', errorType: longSlug,
    });
    const stored = env._inserts[0].params.find(p => typeof p === 'string' && p.startsWith('channel.ig.'));
    expect(stored.length).toBe(64);
  });

  it('all IG slugs fit within the 64-char limit', () => {
    for (const slug of IG_ALL_ERROR_TYPES) {
      expect(slug.length).toBeLessThanOrEqual(64);
      expect(slug.length).toBeGreaterThan(8);
      expect(slug).toMatch(/^channel\./);
    }
  });

  it('exposes the seven IG slugs we wired in PR 3', () => {
    expect(Object.keys(CHANNEL_ERROR_TYPE).sort()).toEqual([
      'IG_HEALTH_PROBE_FAILED',
      'IG_INTEGRATION_NEEDS_REAUTH',
      'IG_RESUBSCRIBE_FAILED',
      'IG_SUBSCRIPTION_LOST',
      'IG_TOKEN_DECRYPT',
      'IG_TOKEN_REJECTED',
      'META_WEBHOOK_SIGNATURE_MISMATCH',
    ]);
  });
});
