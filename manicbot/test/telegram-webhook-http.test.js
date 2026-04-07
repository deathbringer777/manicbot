import { describe, it, expect } from 'vitest';
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
