import { describe, it, expect, beforeEach } from 'vitest';
import { getTenant, putTenant, getTenantIdByBotId, putBot, listTenantIds, getBotIdsByTenantId } from '../src/tenant/storage.js';
import { isMigrationComplete, runMigration } from '../src/tenant/migration.js';

function makeMockKv() {
  const store = new Map();
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    list: async ({ prefix, cursor }) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })), list_complete: true, cursor: undefined };
    },
    delete: async (key) => { store.delete(key); },
  };
}

describe('tenant storage', () => {
  let kv;

  beforeEach(() => {
    kv = makeMockKv();
  });

  it('putTenant and getTenant roundtrip', async () => {
    const data = { id: 'default', name: 'Test', active: true };
    await putTenant(kv, 'default', data);
    const got = await getTenant(kv, 'default');
    expect(got).toBeDefined();
    expect(got.name).toBe('Test');
  });

  it('putBot sets botmap', async () => {
    await putBot(kv, '123', { botId: '123', tenantId: 't1', webhookSecret: 's' });
    expect(await getTenantIdByBotId(kv, '123')).toBe('t1');
  });

  it('listTenantIds returns tenant ids', async () => {
    await putTenant(kv, 't1', { id: 't1' });
    await putTenant(kv, 't2', { id: 't2' });
    const ids = await listTenantIds(kv);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
  });

  it('getBotIdsByTenantId returns bots for tenant', async () => {
    await putBot(kv, 'b1', { botId: 'b1', tenantId: 't1' });
    await putBot(kv, 'b2', { botId: 'b2', tenantId: 't1' });
    const list = await getBotIdsByTenantId(kv, 't1');
    expect(list).toContain('b1');
    expect(list).toContain('b2');
  });
});

describe('migration', () => {
  let kv;

  beforeEach(() => {
    kv = makeMockKv();
  });

  it('runMigration creates default tenant and bot', async () => {
    const env = { BOT_TOKEN: '123:abc', WEBHOOK_SECRET: 'wh' };
    const result = await runMigration(kv, env);
    expect(result.ok).toBe(true);
    expect(result.copied).toBeDefined();
    const tenant = await getTenant(kv, 'default');
    expect(tenant).toBeDefined();
    expect(await getTenantIdByBotId(kv, '123')).toBe('default');
  });

  it('runMigration is idempotent', async () => {
    const env = { BOT_TOKEN: '456:xyz', WEBHOOK_SECRET: 'wh2' };
    await runMigration(kv, env);
    const result2 = await runMigration(kv, env);
    expect(result2.skipped).toBe(true);
  });
});
