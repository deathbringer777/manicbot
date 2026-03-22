import { describe, it, expect, beforeEach } from 'vitest';
import { getTenant, putTenant, getTenantIdByBotId, putBot, listTenantIds, getBotIdsByTenantId } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv };
}

describe('tenant storage (D1)', () => {
  let ctx;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('putTenant and getTenant roundtrip', async () => {
    const data = { id: 'default', name: 'Test', active: true, createdAt: Date.now(), updatedAt: Date.now() };
    await putTenant(ctx, 'default', data);
    const got = await getTenant(ctx, 'default');
    expect(got).toBeDefined();
    expect(got.name).toBe('Test');
  });

  it('putBot sets bot in D1 and token in KV', async () => {
    await putBot(ctx, '123', { botId: '123', tenantId: 't1', botToken: 'tok', webhookSecret: 's', createdAt: Date.now(), updatedAt: Date.now() });
    expect(await getTenantIdByBotId(ctx, '123')).toBe('t1');
  });

  it('listTenantIds returns tenant ids', async () => {
    await putTenant(ctx, 't1', { id: 't1', name: 'A', createdAt: Date.now(), updatedAt: Date.now() });
    await putTenant(ctx, 't2', { id: 't2', name: 'B', createdAt: Date.now(), updatedAt: Date.now() });
    const ids = await listTenantIds(ctx);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
  });

  it('getBotIdsByTenantId returns bots for tenant', async () => {
    await putBot(ctx, 'b1', { botId: 'b1', tenantId: 't1', botToken: 't1', createdAt: Date.now(), updatedAt: Date.now() });
    await putBot(ctx, 'b2', { botId: 'b2', tenantId: 't1', botToken: 't2', createdAt: Date.now(), updatedAt: Date.now() });
    const list = await getBotIdsByTenantId(ctx, 't1');
    expect(list).toContain('b1');
    expect(list).toContain('b2');
  });
});
