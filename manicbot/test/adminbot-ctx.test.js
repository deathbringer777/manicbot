/**
 * Admin/ops bot — ctx builder + webhook registration.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAdminBotCtx, adminBotId, registerAdminBotWebhook } from '../src/adminbot/ctx.js';

const SECRET = 'admin-webhook-secret-32-chars-minimum-xx';

describe('buildAdminBotCtx', () => {
  it('uses ADMIN_BOT_TOKEN and builds a tenant-less admin ctx', () => {
    const ctx = buildAdminBotCtx({ ADMIN_BOT_TOKEN: '777:abc', ADMIN_WEBHOOK_SECRET: SECRET });
    expect(ctx.isAdminBot).toBe(true);
    expect(ctx.tenantId).toBe(null);
    expect(ctx.channel).toBe(null);
    expect(ctx.botId).toBe('777');
    expect(ctx.prefix).toBe('adm:777:');
    expect(ctx.WEBHOOK_SECRET).toBe(SECRET);
    expect(ctx.TG).toContain('/bot777:abc');
  });

  it('falls back to NOTIFY_BOT_TOKEN when no dedicated token', () => {
    const ctx = buildAdminBotCtx({ NOTIFY_BOT_TOKEN: '888:def', ADMIN_WEBHOOK_SECRET: SECRET });
    expect(ctx.botId).toBe('888');
  });

  it('does NOT use BOT_TOKEN unless ADMIN_USE_BOT_TOKEN is opted in', () => {
    expect(buildAdminBotCtx({ BOT_TOKEN: '999:client' })).toBe(null);
    expect(adminBotId({ BOT_TOKEN: '999:client' })).toBe(null);
  });

  it('reuses BOT_TOKEN when ADMIN_USE_BOT_TOKEN=1 (dedicate the report bot)', () => {
    const ctx = buildAdminBotCtx({ ADMIN_USE_BOT_TOKEN: '1', BOT_TOKEN: '555:xyz', ADMIN_WEBHOOK_SECRET: SECRET });
    expect(ctx.botId).toBe('555');
    expect(ctx.isAdminBot).toBe(true);
  });

  it('returns null when no admin/notify token is set', () => {
    expect(buildAdminBotCtx({})).toBe(null);
  });
});

describe('registerAdminBotWebhook', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('refuses when the secret is shorter than 16 chars (no fetch)', async () => {
    const r = await registerAdminBotWebhook({ NOTIFY_BOT_TOKEN: '888:def', ADMIN_WEBHOOK_SECRET: 'short' }, 'https://manicbot.com');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('admin_webhook_secret_too_short');
    expect(globalThis.fetch.mock.calls.length).toBe(0);
  });

  it('refuses a registered client bot via the NOTIFY_BOT_TOKEN fallback (accidental hijack)', async () => {
    const env = {
      NOTIFY_BOT_TOKEN: '888:def',
      ADMIN_WEBHOOK_SECRET: SECRET,
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ tenant_id: 't_salon1' }), all: async () => ({ results: [] }) }) }) },
    };
    const r = await registerAdminBotWebhook(env, 'https://manicbot.com');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('admin_bot_id_is_client_bot');
    // no setWebhook attempted
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/setWebhook'))).toBe(false);
  });

  it('ALLOWS repurposing a registered bot when ADMIN_BOT_TOKEN is explicit (deliberate)', async () => {
    const env = {
      ADMIN_BOT_TOKEN: '888:def', // operator deliberately dedicates this bot
      ADMIN_WEBHOOK_SECRET: SECRET,
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ tenant_id: 't_salon1' }), all: async () => ({ results: [] }) }) }) },
    };
    const r = await registerAdminBotWebhook(env, 'https://manicbot.com');
    expect(r.ok).toBe(true);
    const setWh = globalThis.fetch.mock.calls.find(([u]) => String(u).includes('/setWebhook'));
    expect(setWh).toBeTruthy();
    expect(JSON.parse(setWh[1].body).secret_token).toBe(SECRET);
  });

  it('ALLOWS repurposing the report bot via ADMIN_USE_BOT_TOKEN even if registered', async () => {
    const env = {
      ADMIN_USE_BOT_TOKEN: '1',
      BOT_TOKEN: '555:xyz',
      ADMIN_WEBHOOK_SECRET: SECRET,
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ tenant_id: 't_salon1' }), all: async () => ({ results: [] }) }) }) },
    };
    const r = await registerAdminBotWebhook(env, 'https://manicbot.com');
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://manicbot.com/webhook/555');
  });

  it('registers setWebhook with the secret + allowed_updates when clean', async () => {
    const r = await registerAdminBotWebhook({ NOTIFY_BOT_TOKEN: '888:def', ADMIN_WEBHOOK_SECRET: SECRET }, 'https://manicbot.com/');
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://manicbot.com/webhook/888');
    const setWh = globalThis.fetch.mock.calls.find(([u]) => String(u).includes('/setWebhook'));
    expect(setWh).toBeTruthy();
    const body = JSON.parse(setWh[1].body);
    expect(body.secret_token).toBe(SECRET);
    expect(body.url).toBe('https://manicbot.com/webhook/888');
    expect(body.allowed_updates).toEqual(['message', 'callback_query']);
  });
});
