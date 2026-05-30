import { describe, it, expect, vi } from 'vitest';

// Stub initServices so the dedup-wiring integration test below can drive the
// handler with a fake D1 without booting the real service container. Real
// exports are preserved so nothing else in this file changes behaviour.
vi.mock('../src/services/services.js', async (importActual) => ({
  ...(await importActual()),
  initServices: vi.fn(async () => {}),
}));

import { tryTelegramWebhook } from '../src/http/telegramWebhookHttp.js';
import { timingSafeEqual } from '../src/utils/security.js';

describe('timingSafeEqual (sync, used by Telegram webhook)', () => {
  it('returns true only when strings match', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });
  it('returns false for same-length mismatch (regression: was broken when using subtle.timingSafeEqual Promise)', () => {
    expect(timingSafeEqual('secret', 'secrex')).toBe(false);
    expect(timingSafeEqual('aaaa', 'aaab')).toBe(false);
  });
  it('returns false for different lengths', () => {
    expect(timingSafeEqual('a', 'ab')).toBe(false);
  });
});

describe('tryTelegramWebhook', () => {
  // Webhook secret must be ≥ 16 chars per security policy.
  const HOOK_SECRET = 'my-strong-webhook-secret-1234';
  const baseCtx = { WEBHOOK_SECRET: HOOK_SECRET, kv: {} };

  function post(path, headers, body) {
    return new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    });
  }

  it('returns 403 when secret token is wrong (including same length)', async () => {
    const wrong = HOOK_SECRET.slice(0, -1) + 'X';
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': wrong }, {});
    const res = await tryTelegramWebhook(req, baseCtx, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('returns 200 OK for valid secret and empty update', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': HOOK_SECRET }, {});
    const res = await tryTelegramWebhook(req, baseCtx, new URL(req.url));
    expect(res.status).toBe(200);
  });

  it('returns null for non-matching path', async () => {
    const req = post('/other', { 'X-Telegram-Bot-Api-Secret-Token': HOOK_SECRET }, {});
    const res = await tryTelegramWebhook(req, baseCtx, new URL(req.url));
    expect(res).toBeNull();
  });

  // Security regression: webhook MUST refuse to accept requests when no secret is configured.
  // This was previously a "warn-and-allow" mode that allowed unauthenticated POSTs.
  it('returns 503 when WEBHOOK_SECRET is empty (refuses unauth webhook)', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': '' }, {});
    const res = await tryTelegramWebhook(req, { ...baseCtx, WEBHOOK_SECRET: '' }, new URL(req.url));
    expect(res.status).toBe(503);
  });

  it('returns 503 when WEBHOOK_SECRET is null (refuses unauth webhook)', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': '' }, {});
    const res = await tryTelegramWebhook(req, { ...baseCtx, WEBHOOK_SECRET: null }, new URL(req.url));
    expect(res.status).toBe(503);
  });

  it('returns 503 when WEBHOOK_SECRET is too short (< 16 chars)', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': 'short' }, {});
    const res = await tryTelegramWebhook(req, { ...baseCtx, WEBHOOK_SECRET: 'short' }, new URL(req.url));
    expect(res.status).toBe(503);
  });
});

// ─── A4 regression ───────────────────────────────────────────────────────────
// The dedup caller must forward the D1 binding (ctx.db) so the atomic
// INSERT ... ON CONFLICT DO NOTHING path engages. The bug passed only
// `{ MANICBOT: ctx.kv }`, silently degrading the "dual" backend to the
// race-prone KV-only fallback (KV has no CAS).
describe('tryTelegramWebhook — forwards the D1 dedup binding (A4)', () => {
  const HOOK_SECRET = 'my-strong-webhook-secret-1234';

  function makeFakeKV() {
    const store = new Map();
    return { store, async get(k) { return store.get(k) ?? null; }, async put(k, v) { store.set(k, v); } };
  }
  function makeFakeD1() {
    const rows = new Map();
    return {
      rows,
      prepare(sql) {
        return {
          _p: [],
          bind(...p) { this._p = p; return this; },
          async run() {
            if (/INSERT\s+INTO\s+webhook_dedup/i.test(sql)) {
              const key = this._p[0];
              if (rows.has(key)) return { meta: { changes: 0 } };
              rows.set(key, true);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
  }
  function post(path, headers, body) {
    return new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
  }

  it('writes the claim into D1 (atomic path) when ctx.db is bound', async () => {
    const fakeD1 = makeFakeD1();
    const ctx = { WEBHOOK_SECRET: HOOK_SECRET, kv: makeFakeKV(), db: fakeD1 };
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': HOOK_SECRET }, { update_id: 555 });
    const res = await tryTelegramWebhook(req, ctx, new URL(req.url));
    expect(res.status).toBe(200);
    // Would be 0 if the caller dropped the DB binding (KV-only fallback).
    expect(fakeD1.rows.size).toBe(1);
  });
});
