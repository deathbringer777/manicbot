import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveTenantFromBotId,
  buildTenantCtx,
  buildLegacyCtx,
  isMigrationDone,
} from '../src/tenant/resolver.js';
import { putTenant, putBot } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeTestCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv };
}

describe('tenant resolver (D1)', () => {
  let ctx;
  const env = {
    MANICBOT: null,
    DB: null,
    BOT_TOKEN: '12345:AAxxx',
    ADMIN_KEY: 'adm',
    WEBHOOK_SECRET: 'wh',
    ADMIN_CHAT_ID: null,
    AI: null,
    WORKERS_AI_API_TOKEN: null,
    CLOUDFLARE_ACCOUNT_ID: null,
  };

  beforeEach(() => {
    ctx = makeTestCtx();
    env.MANICBOT = ctx.kv;
    env.DB = ctx.db;
  });

  it('resolveTenantFromBotId returns null when bot not in registry', async () => {
    const out = await resolveTenantFromBotId(ctx, '999', null);
    expect(out).toBeNull();
  });

  it('resolveTenantFromBotId returns context when tenant and bot exist', async () => {
    await putTenant(ctx, 't1', { id: 't1', name: 'Salon 1', active: true, createdAt: Date.now(), updatedAt: Date.now() });
    await putBot(ctx, '123', { botId: '123', tenantId: 't1', botToken: '123:secret', webhookSecret: 'wh1', active: true, createdAt: Date.now(), updatedAt: Date.now() });
    const out = await resolveTenantFromBotId(ctx, '123', null);
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
    const result = buildTenantCtx(env, resolved);
    expect(result.prefix).toBe('t:default:');
    expect(result.tenantId).toBe('default');
    expect(result.db).toBe(ctx.db);
  });

  it('buildLegacyCtx sets prefix b:{botId}: and tenantId null', () => {
    const result = buildLegacyCtx(env);
    expect(result.prefix).toBe('b:12345:');
    expect(result.tenantId).toBeNull();
    expect(result.db).toBe(ctx.db);
  });

  it('isMigrationDone returns false when bot not mapped', async () => {
    expect(await isMigrationDone(ctx, '123')).toBe(false);
  });

  it('isMigrationDone returns true when bot exists in D1', async () => {
    await putBot(ctx, '123', { botId: '123', tenantId: 'default', botToken: '123:x', webhookSecret: 'wh', createdAt: Date.now(), updatedAt: Date.now() });
    expect(await isMigrationDone(ctx, '123')).toBe(true);
  });
});
