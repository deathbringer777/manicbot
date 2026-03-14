import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveTenantFromBotId,
  buildTenantCtx,
  buildLegacyCtx,
  isMigrationDone,
} from '../src/tenant/resolver.js';
import { putTenant, putBot } from '../src/tenant/storage.js';

function makeMockKv() {
  const store = new Map();
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value, _opts) => {
      const out = typeof value === 'string' ? value : JSON.stringify(value);
      store.set(key, out);
    },
    list: async ({ prefix, cursor }) => {
      const keys = [...store.keys()].filter((k) => !prefix || k.startsWith(prefix));
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: undefined };
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
}

describe('tenant resolver', () => {
  let kv;
  const env = {
    MANICBOT: null,
    BOT_TOKEN: '12345:AAxxx',
    ADMIN_KEY: 'adm',
    WEBHOOK_SECRET: 'wh',
    ADMIN_CHAT_ID: null,
    AI: null,
    WORKERS_AI_API_TOKEN: null,
    CLOUDFLARE_ACCOUNT_ID: null,
  };

  beforeEach(() => {
    kv = makeMockKv();
    env.MANICBOT = kv;
  });

  it('resolveTenantFromBotId returns null when bot not in registry', async () => {
    const out = await resolveTenantFromBotId(kv, '999', null);
    expect(out).toBeNull();
  });

  it('resolveTenantFromBotId returns null when tenant or bot missing', async () => {
    await kv.put('botmap:123', 't1');
    const out = await resolveTenantFromBotId(kv, '123', null);
    expect(out).toBeNull();
  });

  it('resolveTenantFromBotId returns context when tenant and bot exist', async () => {
    await putTenant(kv, 't1', { id: 't1', name: 'Salon 1', active: true });
    await putBot(kv, '123', {
      botId: '123',
      tenantId: 't1',
      botToken: '123:secret',
      webhookSecret: 'wh1',
      active: true,
    });
    const out = await resolveTenantFromBotId(kv, '123', null);
    expect(out).not.toBeNull();
    expect(out.tenantId).toBe('t1');
    expect(out.tenant.name).toBe('Salon 1');
    expect(out.bot.botId).toBe('123');
    expect(out.TG).toContain('123:secret');
  });

  it('buildTenantCtx sets prefix t:{tenantId}:', () => {
    const resolved = {
      tenantId: 'default',
      tenant: { id: 'default', name: 'Test' },
      bot: { botId: '123', botToken: 'x', webhookSecret: 'y' },
      TG: 'https://api.telegram.org/botx',
    };
    const ctx = buildTenantCtx(env, resolved);
    expect(ctx.prefix).toBe('t:default:');
    expect(ctx.tenantId).toBe('default');
    expect(ctx.tenant.name).toBe('Test');
    expect(ctx.WEBHOOK_SECRET).toBe('y');
    expect(ctx.kv).toBe(kv);
    expect(ctx.globalKv).toBe(kv);
  });

  it('buildLegacyCtx sets prefix b:{botId}: and tenantId null', () => {
    const ctx = buildLegacyCtx(env);
    expect(ctx.prefix).toBe('b:12345:');
    expect(ctx.tenantId).toBeNull();
    expect(ctx.tenant).toBeNull();
    expect(ctx.bot.botId).toBe('12345');
    expect(ctx.bot.webhookSecret).toBe(env.WEBHOOK_SECRET);
    expect(ctx.WEBHOOK_SECRET).toBe('wh');
    expect(ctx.globalKv).toBe(kv);
  });

  it('isMigrationDone returns false when bot not mapped', async () => {
    expect(await isMigrationDone(kv, '123')).toBe(false);
  });

  it('isMigrationDone returns true when botmap exists', async () => {
    await kv.put('botmap:123', 'default');
    expect(await isMigrationDone(kv, '123')).toBe(true);
  });
});
