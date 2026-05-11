/**
 * P2-4 — Ensure buildTenantCtx and buildChannelCtx share the same env-spread
 * surface (baseCtx). Two flows diverging on env keys (BOT_ENCRYPTION_KEY_OLD,
 * GOOGLE_*, APP_BASE_URL, ADMIN_APP_URL) was a class of subtle bug — see
 * relax.md §1 P1.
 */
import { describe, it, expect } from 'vitest';
import { buildTenantCtx } from '../src/tenant/resolver.js';
import { buildChannelCtx } from '../src/channels/resolver.js';

function mockEnv() {
  return {
    DB: null,
    MANICBOT: { get: async () => null, put: async () => {} },
    ADMIN_KEY: 'x'.repeat(32),
    ADMIN_CHAT_ID: '12345',
    AI: { run: async () => ({}) },
    WORKERS_AI_API_TOKEN: 'tok',
    CLOUDFLARE_ACCOUNT_ID: 'acc',
    BOT_ENCRYPTION_KEY: 'k'.repeat(32),
    BOT_ENCRYPTION_KEY_OLD: 'o'.repeat(32),
    GOOGLE_SERVICE_ACCOUNT_KEY: 'g',
    GOOGLE_OAUTH_CLIENT_ID: 'gci',
    GOOGLE_OAUTH_CLIENT_SECRET: 'gcs',
    GOOGLE_OAUTH_REDIRECT_URI: 'gru',
    GOOGLE_TOKEN_ENCRYPTION_KEY: 'gtek',
    APP_BASE_URL: 'https://manicbot.com',
    ADMIN_APP_URL: 'https://admin-app-3nc.pages.dev',
    BOT_TOKEN: '123:fake',
    WEBHOOK_SECRET: 'wh',
  };
}

const REQUIRED_BASE_KEYS = [
  'kv',
  'globalKv',
  'db',
  'ADMIN_KEY',
  'adminChatId',
  'ADMIN_CHAT_ID',
  'AI',
  'WORKERS_AI_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'BOT_ENCRYPTION_KEY',
  'BOT_ENCRYPTION_KEY_OLD',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
  'APP_BASE_URL',
  'baseUrl',
  'ADMIN_APP_URL',
];

describe('baseCtx parity (P2-4)', () => {
  it('buildTenantCtx exposes every required base key', () => {
    const env = mockEnv();
    const ctx = buildTenantCtx(env, {
      tenantId: 't_test',
      tenant: { id: 't_test', name: 'Test' },
      bot: { botId: 'b1', botToken: 'x', webhookSecret: 'w', active: 1 },
      TG: 'https://api.telegram.org/botx',
    });
    for (const key of REQUIRED_BASE_KEYS) {
      expect(ctx).toHaveProperty(key);
    }
    // Tenant-specific fields
    expect(ctx.tenantId).toBe('t_test');
    expect(ctx.prefix).toBe('t:t_test:');
    expect(ctx.WEBHOOK_SECRET).toBe('w');
    expect(typeof ctx.channel).toBe('object');
  });

  it('buildChannelCtx exposes every required base key', async () => {
    const env = mockEnv();
    // Stub DB minimally so getTenant returns a tenant.
    env.DB = {
      prepare(_sql) {
        return {
          bind() { return this; },
          async first() {
            // first() is used inside getTenant() — emulate a registered tenant row
            return { id: 't_test', name: 'Test' };
          },
          async all() {
            // getBotIdsByTenantId returns empty → bot=null, botToken=null
            return { results: [] };
          },
        };
      },
    };
    const channelConfig = { id: 'cc1', tenant_id: 't_test', channel_type: 'whatsapp' };
    const channelAdapter = { send: async () => {} };
    const ctx = await buildChannelCtx(env, 't_test', channelConfig, channelAdapter);
    expect(ctx).toBeTruthy();
    for (const key of REQUIRED_BASE_KEYS) {
      expect(ctx).toHaveProperty(key);
    }
    expect(ctx.tenantId).toBe('t_test');
    expect(ctx.prefix).toBe('t:t_test:');
    expect(ctx.WEBHOOK_SECRET).toBeNull();
    expect(ctx.channelConfig).toBe(channelConfig);
  });

  it('buildTenantCtx and buildChannelCtx produce the same base key set', async () => {
    const env = mockEnv();
    env.DB = {
      prepare(_sql) {
        return {
          bind() { return this; },
          async first() { return { id: 't_test', name: 'Test' }; },
          async all() { return { results: [] }; },
        };
      },
    };
    const tenantCtx = buildTenantCtx(env, {
      tenantId: 't_test',
      tenant: { id: 't_test', name: 'Test' },
      bot: { botId: 'b1', botToken: 'x', webhookSecret: 'w', active: 1 },
      TG: 'https://api.telegram.org/botx',
    });
    const channelCtx = await buildChannelCtx(env, 't_test', { id: 'cc1' }, { send: async () => {} });

    // Compare the *base* keys (everything that flows through baseCtx).
    const tenantBase = new Set(REQUIRED_BASE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(tenantCtx, k)));
    const channelBase = new Set(REQUIRED_BASE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(channelCtx, k)));
    expect([...tenantBase].sort()).toEqual([...channelBase].sort());
    expect(tenantBase.size).toBe(REQUIRED_BASE_KEYS.length);
  });
});
