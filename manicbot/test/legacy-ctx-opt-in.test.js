/**
 * P2-3 — Legacy single-bot ctx (env BOT_TOKEN + WEBHOOK_SECRET) must default
 * to disabled now that all bot tokens live in D1 with per-bot encryption.
 * Setting ALLOW_LEGACY_BOT_CTX=1 explicitly re-enables it; without it,
 * getCtx returns null when the only signal is env BOT_TOKEN.
 */
import { describe, it, expect } from 'vitest';
import { getCtx } from '../src/http/resolveCtx.js';

function mockEnv(overrides = {}) {
  return {
    DB: null, // no D1 → forces legacy path consideration
    MANICBOT: { get: async () => null, put: async () => {} },
    BOT_TOKEN: '123:fake',
    WEBHOOK_SECRET: 'wh',
    BOT_ENCRYPTION_KEY: 'k'.repeat(32),
    ADMIN_KEY: 'x'.repeat(32),
    ...overrides,
  };
}

describe('legacy bot ctx is opt-in (P2-3)', () => {
  it('returns null by default when only env BOT_TOKEN is set', async () => {
    const env = mockEnv();
    const url = new URL('https://manicbot.com/');
    const req = new Request(url, { method: 'GET' });
    const ctx = await getCtx(env, url, req);
    expect(ctx).toBeNull();
  });

  it('returns a legacy ctx when ALLOW_LEGACY_BOT_CTX=1', async () => {
    const env = mockEnv({ ALLOW_LEGACY_BOT_CTX: '1' });
    const url = new URL('https://manicbot.com/');
    const req = new Request(url, { method: 'GET' });
    const ctx = await getCtx(env, url, req);
    expect(ctx).toBeTruthy();
    expect(ctx.bot?.botToken).toBe('123:fake');
    expect(ctx.WEBHOOK_SECRET).toBe('wh');
  });

  it('returns null with ALLOW_LEGACY_BOT_CTX unset even with BOT_TOKEN', async () => {
    const env = mockEnv({ ALLOW_LEGACY_BOT_CTX: '0' });
    const url = new URL('https://manicbot.com/');
    const req = new Request(url, { method: 'GET' });
    const ctx = await getCtx(env, url, req);
    expect(ctx).toBeNull();
  });

  it('Meta /webhook/wa still returns null (handled elsewhere)', async () => {
    const env = mockEnv();
    const url = new URL('https://manicbot.com/webhook/wa');
    const req = new Request(url, { method: 'POST' });
    // The handler returns from the early Meta-segment guard — falls through
    // to BOT_TOKEN check, which now returns null without ALLOW_LEGACY_BOT_CTX.
    const ctx = await getCtx(env, url, req);
    expect(ctx).toBeNull();
  });
});
