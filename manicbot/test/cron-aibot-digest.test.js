import { describe, it, expect } from 'vitest';
import {
  recordAiBotHit,
  sumAiBotHits,
  buildAiBotDigestText,
  maybeRunAiBotDigest,
} from '../src/utils/aiBotAnalytics.js';

/** Minimal in-memory KV mock supporting get(key,'json') + put(key,val). */
function mockKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, val) {
      store.set(key, val);
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const T = Date.UTC(2026, 5, 19, 12, 0, 0); // 2026-06-19T12:00Z

describe('aiBotAnalytics', () => {
  describe('recordAiBotHit', () => {
    it('creates the daily bucket and increments the bot count', async () => {
      const KV = mockKV();
      await recordAiBotHit({ MANICBOT: KV }, 'PerplexityBot', T);
      expect(JSON.parse(KV.store.get('aibot:2026-06-19'))).toEqual({ PerplexityBot: 1 });
    });

    it('accumulates multiple hits and multiple bots in one UTC day', async () => {
      const KV = mockKV();
      const env = { MANICBOT: KV };
      await recordAiBotHit(env, 'PerplexityBot', T);
      await recordAiBotHit(env, 'PerplexityBot', T + 1000);
      await recordAiBotHit(env, 'OAI-SearchBot', T + 2000);
      expect(JSON.parse(KV.store.get('aibot:2026-06-19'))).toEqual({
        PerplexityBot: 2,
        'OAI-SearchBot': 1,
      });
    });

    it('is a no-op without KV or without a bot name (never throws)', async () => {
      await expect(recordAiBotHit({}, 'GPTBot', T)).resolves.toBeUndefined();
      const KV = mockKV();
      await recordAiBotHit({ MANICBOT: KV }, null, T);
      expect(KV.store.size).toBe(0);
    });
  });

  describe('sumAiBotHits', () => {
    it('sums per-bot counts across the trailing N days', async () => {
      const KV = mockKV({
        'aibot:2026-06-19': JSON.stringify({ PerplexityBot: 3, GPTBot: 1 }),
        'aibot:2026-06-17': JSON.stringify({ PerplexityBot: 2 }),
        'aibot:2026-06-10': JSON.stringify({ PerplexityBot: 99 }), // outside the 7d window
      });
      const { totals, grand } = await sumAiBotHits({ MANICBOT: KV }, T, 7);
      expect(totals).toEqual({ PerplexityBot: 5, GPTBot: 1 });
      expect(grand).toBe(6);
    });

    it('returns empty totals when there is no KV', async () => {
      expect(await sumAiBotHits({}, T, 7)).toEqual({ totals: {}, grand: 0 });
    });
  });

  describe('buildAiBotDigestText', () => {
    it('sorts bots by count desc and annotates week-over-week deltas', () => {
      const text = buildAiBotDigestText(
        { totals: { PerplexityBot: 5, GPTBot: 2, 'Claude-SearchBot': 1 }, grand: 8 },
        { totals: { PerplexityBot: 3, GPTBot: 2 }, grand: 5 },
      );
      expect(text).toContain('PerplexityBot: 5 (+2 WoW)');
      expect(text).toContain('GPTBot: 2'); // unchanged → no delta suffix
      expect(text).toContain('Claude-SearchBot: 1 (new)');
      expect(text).toContain('Total: 8 (prev 7d: 5)');
      // Highest count must be listed first.
      expect(text.indexOf('PerplexityBot')).toBeLessThan(text.indexOf('GPTBot'));
    });

    it('handles an empty week gracefully', () => {
      const text = buildAiBotDigestText({ totals: {}, grand: 0 }, { totals: {}, grand: 0 });
      expect(text).toContain('No AI-bot hits recorded this week.');
      expect(text).toContain('Total: 0');
    });
  });

  describe('maybeRunAiBotDigest', () => {
    it('seeds the timer on first run WITHOUT sending', async () => {
      const KV = mockKV();
      const calls = [];
      const r = await maybeRunAiBotDigest({ MANICBOT: KV }, T, {
        fetch: async (...a) => { calls.push(a); return { ok: true }; },
      });
      expect(r).toEqual({ seeded: true });
      expect(calls).toHaveLength(0);
      expect(KV.store.get('aibot:last_digest')).toBe(String(T));
    });

    it('skips when the last digest was under 7 days ago', async () => {
      const KV = mockKV({ 'aibot:last_digest': String(T - 3 * DAY) });
      const calls = [];
      const r = await maybeRunAiBotDigest({ MANICBOT: KV }, T, {
        fetch: async (...a) => { calls.push(a); return { ok: true }; },
      });
      expect(r).toEqual({ skipped: 'not_due' });
      expect(calls).toHaveLength(0);
    });

    it('sends a digest when ≥7 days elapsed and bumps the timestamp', async () => {
      const KV = mockKV({
        'aibot:last_digest': String(T - 8 * DAY),
        'aibot:2026-06-19': JSON.stringify({ PerplexityBot: 4 }),
        'aibot:2026-06-15': JSON.stringify({ GPTBot: 2 }),
      });
      const env = { MANICBOT: KV, BOT_TOKEN: 'x'.repeat(40), ADMIN_CHAT_ID: '123' };
      const calls = [];
      const r = await maybeRunAiBotDigest(env, T, {
        fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true }; },
      });
      expect(r.sent).toBe(true);
      expect(r.grand).toBe(6);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain('/sendMessage');
      const body = JSON.parse(calls[0].opts.body);
      expect(body.text).toContain('PerplexityBot: 4');
      expect(KV.store.get('aibot:last_digest')).toBe(String(T));
    });

    it('returns no_kv when KV is absent', async () => {
      expect(await maybeRunAiBotDigest({}, T)).toEqual({ skipped: 'no_kv' });
    });
  });
});
