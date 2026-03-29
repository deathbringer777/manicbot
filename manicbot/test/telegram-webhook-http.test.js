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
  const baseCtx = { WEBHOOK_SECRET: 'my-hook-secret', kv: {} };

  function post(path, headers, body) {
    return new Request(`https://example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body ?? {}),
    });
  }

  it('returns 403 when secret token is wrong (including same length)', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': 'my-hook-secreX' }, {});
    const res = await tryTelegramWebhook(req, baseCtx, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('returns 200 OK for valid secret and empty update', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': 'my-hook-secret' }, {});
    const res = await tryTelegramWebhook(req, baseCtx, new URL(req.url));
    expect(res.status).toBe(200);
  });

  it('returns null for non-matching path', async () => {
    const req = post('/other', { 'X-Telegram-Bot-Api-Secret-Token': 'my-hook-secret' }, {});
    const res = await tryTelegramWebhook(req, baseCtx, new URL(req.url));
    expect(res).toBeNull();
  });

  it('returns 500 when WEBHOOK_SECRET is not configured (no empty-secret bypass)', async () => {
    const req = post('/webhook/bot1', { 'X-Telegram-Bot-Api-Secret-Token': '' }, {});
    const res = await tryTelegramWebhook(req, { ...baseCtx, WEBHOOK_SECRET: '' }, new URL(req.url));
    expect(res.status).toBe(500);
  });
});
