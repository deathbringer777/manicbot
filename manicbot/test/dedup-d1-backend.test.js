/**
 * Tests for the D1-backed webhook dedup added in migration 0089.
 *
 * The existing KV-only tests (dedup-race-window.test.js + wa-webhook-dedup.test.js)
 * remain valid for the legacy backend. This file locks in the new contract:
 *
 *   1. Atomic claim via INSERT OR IGNORE ON CONFLICT DO NOTHING
 *   2. Concurrent-claim semantics (Promise.all of N → exactly 1 true)
 *   3. Backend selection via env.WEBHOOK_DEDUP_BACKEND ∈ kv|d1|dual
 *   4. Dual-write rollout: D1 is the source of truth, KV mirrored for
 *      instant rollback to the KV-only backend
 *   5. Graceful fallback when D1 binding is missing
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimTelegramUpdate,
  claimMetaMessage,
  claimWAMessage,
  claimOnce,
} from '../src/utils/dedup.js';

// ─── In-memory fakes ─────────────────────────────────────────────────────────

function makeFakeKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const v = store.get(key);
      if (!v) return null;
      if (v.expires && v.expires < Date.now()) {
        store.delete(key);
        return null;
      }
      return v.value;
    },
    async put(key, value, opts = {}) {
      const expires = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : null;
      store.set(key, { value, expires });
    },
  };
}

function makeFakeD1() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...p) { this._params = p; return this; },
        async run() {
          const sql = this._sql;
          const ins = sql.match(/INSERT\s+INTO\s+webhook_dedup\s*\(([^)]+)\)\s*VALUES\s*\([^)]+\)\s*ON\s+CONFLICT\s*\(key\)\s*DO\s+NOTHING/i);
          if (ins) {
            const [key, expiresAt, createdAt] = this._params;
            if (rows.has(key)) return { success: true, meta: { changes: 0 } };
            rows.set(key, { key, expires_at: expiresAt, created_at: createdAt });
            return { success: true, meta: { changes: 1 } };
          }
          const del = sql.match(/DELETE\s+FROM\s+webhook_dedup\s+WHERE\s+expires_at\s*<\s*\?/i);
          if (del) {
            const cutoff = this._params[0];
            let changes = 0;
            for (const [k, v] of [...rows]) {
              if (v.expires_at < cutoff) { rows.delete(k); changes++; }
            }
            return { success: true, meta: { changes } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async all() {
          return { results: [...rows.values()] };
        },
      };
    },
  };
}

function makeEnv({ backend, withKv = true, withDb = true } = {}) {
  const env = {};
  if (backend) env.WEBHOOK_DEDUP_BACKEND = backend;
  if (withKv) env.MANICBOT = makeFakeKV();
  if (withDb) env.DB = makeFakeD1();
  return env;
}

// ─── Sequential contract ─────────────────────────────────────────────────────

describe('D1 backend — sequential claim semantics', () => {
  it('first claim wins, second is rejected (telegram)', async () => {
    const env = makeEnv({ backend: 'd1' });
    expect(await claimTelegramUpdate(env, 'bot1', 100)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 100)).toBe(false);
  });

  it('different (bot, update) pairs are independent', async () => {
    const env = makeEnv({ backend: 'd1' });
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 2)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot2', 1)).toBe(true);
  });

  it('IG and WA keys do not collide on shared id', async () => {
    const env = makeEnv({ backend: 'd1' });
    expect(await claimMetaMessage(env, 'page1', 'shared-id')).toBe(true);
    expect(await claimWAMessage(env, 'page1', 'shared-id')).toBe(true);
  });
});

// ─── The concurrency test the KV impl COULD NOT pass ─────────────────────────

describe('D1 backend — concurrent claims', () => {
  it('50 parallel claims for the same key → exactly 1 returns true', async () => {
    const env = makeEnv({ backend: 'd1' });
    const results = await Promise.all(
      Array.from({ length: 50 }, () => claimTelegramUpdate(env, 'b', 999)),
    );
    const wins = results.filter((v) => v === true).length;
    expect(wins).toBe(1);
    expect(results.filter((v) => v === false)).toHaveLength(49);
  });

  it('parallel claims for different keys all win', async () => {
    const env = makeEnv({ backend: 'd1' });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claimMetaMessage(env, 'p1', `mid-${i}`)),
    );
    expect(results.filter((v) => v === true)).toHaveLength(10);
  });
});

// ─── Backend selection ──────────────────────────────────────────────────────

describe('backend selection via env.WEBHOOK_DEDUP_BACKEND', () => {
  it('defaults to dual when unset', async () => {
    const env = makeEnv({}); // no backend key → default
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(false);
    // D1 has the row
    expect(env.DB.rows.size).toBe(1);
    // KV also has it (audit mirror)
    expect(env.MANICBOT.store.size).toBe(1);
  });

  it('backend=kv ignores D1 entirely', async () => {
    const env = makeEnv({ backend: 'kv' });
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(env.DB.rows.size).toBe(0);
    expect(env.MANICBOT.store.size).toBe(1);
  });

  it('backend=d1 ignores KV entirely', async () => {
    const env = makeEnv({ backend: 'd1' });
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(env.DB.rows.size).toBe(1);
    expect(env.MANICBOT.store.size).toBe(0);
  });

  it('backend=dual but D1 unbound → falls through to KV verdict', async () => {
    const env = makeEnv({ backend: 'dual', withDb: false });
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(false);
    expect(env.MANICBOT.store.size).toBe(1);
  });

  it('backend=d1 but D1 unbound → fallback to KV (graceful degradation)', async () => {
    const env = makeEnv({ backend: 'd1', withDb: false });
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(false);
    expect(env.MANICBOT.store.size).toBe(1);
  });
});

describe('legacy KV contract still works (no env backend = dual)', () => {
  it('claimOnce arbitrary key', async () => {
    const env = makeEnv({ backend: 'd1' });
    expect(await claimOnce(env, 'foo:bar:baz', 60)).toBe(true);
    expect(await claimOnce(env, 'foo:bar:baz', 60)).toBe(false);
  });

  it('returns true when no backend is available (legacy/test envs)', async () => {
    expect(await claimTelegramUpdate({}, 'bot1', 1)).toBe(true);
  });
});
