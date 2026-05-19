/**
 * Unit tests for the KV-backed webhook dedup helpers in src/utils/dedup.js.
 *
 * These lock in the GET-then-PUT contract and document the
 * eventual-consistency limitation. See the @fileoverview comment in
 * dedup.js for the full rationale.
 *
 * Note on concurrency: Cloudflare Workers KV has no compare-and-swap
 * primitive, so a *true* concurrent race against the same key cannot be
 * resolved by these helpers — both racers will read `null`, both will
 * PUT, and both will return `true`. That race is not reachable from a
 * Node/Vitest harness (there is no global KV edge to race against) and
 * also not reachable in production from Telegram/Meta retries, which
 * are spaced ≥1s apart. We therefore test the *sequential* contract
 * (first claim wins, second is rejected) plus the TTL-expiry path —
 * the two properties the call sites actually depend on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimTelegramUpdate,
  claimMetaMessage,
  claimWAMessage,
  claimOnce,
} from '../src/utils/dedup.js';

function makeMockKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const row = store.get(key);
      if (!row) return null;
      if (row.expiresAt && row.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return row.value;
    },
    async put(key, value, opts = {}) {
      const ttl = opts.expirationTtl;
      const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
      store.set(key, { value, expiresAt });
    },
  };
}

describe('claimTelegramUpdate', () => {
  let kv;
  beforeEach(() => { kv = makeMockKV(); });

  it('first claim returns true, second sequential claim returns false', async () => {
    const env = { MANICBOT: kv };
    expect(await claimTelegramUpdate(env, 'bot1', 42)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 42)).toBe(false);
  });

  it('different (botId, updateId) tuples do not collide', async () => {
    const env = { MANICBOT: kv };
    expect(await claimTelegramUpdate(env, 'bot1', 1)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot1', 2)).toBe(true);
    expect(await claimTelegramUpdate(env, 'bot2', 1)).toBe(true);
  });

  it('after TTL expiry, claim succeeds again', async () => {
    const env = { MANICBOT: kv };
    expect(await claimTelegramUpdate(env, 'bot1', 7)).toBe(true);
    // Force-expire the stored row.
    for (const row of kv.store.values()) row.expiresAt = Date.now() - 1;
    expect(await claimTelegramUpdate(env, 'bot1', 7)).toBe(true);
  });

  it('no KV binding → fail-open (returns true so caller still processes)', async () => {
    expect(await claimTelegramUpdate({}, 'bot1', 1)).toBe(true);
  });

  it('writes a 5-minute TTL on the claim row', async () => {
    const env = { MANICBOT: kv };
    await claimTelegramUpdate(env, 'bot1', 99);
    const row = kv.store.get('tg:upd:bot1:99');
    expect(row).toBeTruthy();
    const ttlMs = row.expiresAt - Date.now();
    // 5 min = 300_000 ms; allow generous slack for slow runners.
    expect(ttlMs).toBeGreaterThan(290_000);
    expect(ttlMs).toBeLessThanOrEqual(300_000);
  });
});

describe('claimMetaMessage (Instagram)', () => {
  let kv;
  beforeEach(() => { kv = makeMockKV(); });

  it('first/second sequential claim contract', async () => {
    const env = { MANICBOT: kv };
    expect(await claimMetaMessage(env, 'page1', 'mid.abc')).toBe(true);
    expect(await claimMetaMessage(env, 'page1', 'mid.abc')).toBe(false);
  });

  it('writes a 24h TTL', async () => {
    const env = { MANICBOT: kv };
    await claimMetaMessage(env, 'page1', 'mid.xyz');
    const row = kv.store.get('ig:msg:page1:mid.xyz');
    const ttlMs = row.expiresAt - Date.now();
    expect(ttlMs).toBeGreaterThan(86_400_000 - 10_000);
    expect(ttlMs).toBeLessThanOrEqual(86_400_000);
  });
});

describe('claimWAMessage (WhatsApp)', () => {
  let kv;
  beforeEach(() => { kv = makeMockKV(); });

  it('first/second sequential claim contract', async () => {
    const env = { MANICBOT: kv };
    expect(await claimWAMessage(env, 'pn1', 'wamid.AAA')).toBe(true);
    expect(await claimWAMessage(env, 'pn1', 'wamid.AAA')).toBe(false);
  });

  it('uses a distinct namespace from Instagram (no cross-channel collision)', async () => {
    const env = { MANICBOT: kv };
    await claimWAMessage(env, 'shared', 'id1');
    // Same id under IG namespace is independent.
    expect(await claimMetaMessage(env, 'shared', 'id1')).toBe(true);
  });
});

describe('claimOnce', () => {
  let kv;
  beforeEach(() => { kv = makeMockKV(); });

  it('honours the per-call TTL argument', async () => {
    const env = { MANICBOT: kv };
    await claimOnce(env, 'arbitrary:key', 60);
    const row = kv.store.get('arbitrary:key');
    const ttlMs = row.expiresAt - Date.now();
    expect(ttlMs).toBeGreaterThan(55_000);
    expect(ttlMs).toBeLessThanOrEqual(60_000);
  });

  it('first/second sequential claim contract', async () => {
    const env = { MANICBOT: kv };
    expect(await claimOnce(env, 'k')).toBe(true);
    expect(await claimOnce(env, 'k')).toBe(false);
  });
});
