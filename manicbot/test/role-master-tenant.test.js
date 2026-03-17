/**
 * Тесты: назначение мастера только внутри одного тенанта.
 * Пользователя можно добавить мастером только если он уже заходил в этого бота (есть u:{chatId} в этом тенанте).
 */

import { describe, it, expect } from 'vitest';
import { saveMaster, listMasters, getMaster, deleteMaster, getUser } from '../src/services/users.js';
import { kvGet, kvPut } from '../src/utils/kv.js';

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
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix } = {}) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })), list_complete: true };
    },
  };
}

function makeCtx(kv, tenantId = 't_salon1') {
  return { kv, prefix: `t:${tenantId}:`, tenantId };
}

const masterData = {
  chatId: 111,
  name: 'Test',
  tgUsername: null,
  phone: null,
  addedAt: Date.now(),
  active: true,
};

describe('Master assignment — tenant isolation', () => {
  it('masters are stored under tenant prefix (listMasters only sees own tenant)', async () => {
    const kv = makeMockKv();
    const ctx1 = makeCtx(kv, 't_salon1');
    const ctx2 = makeCtx(kv, 't_salon2');
    await saveMaster(ctx1, 100, { ...masterData, chatId: 100, name: 'Salon1' });
    await saveMaster(ctx2, 200, { ...masterData, chatId: 200, name: 'Salon2' });
    const list1 = await listMasters(ctx1);
    const list2 = await listMasters(ctx2);
    expect(list1).toHaveLength(1);
    expect(list2).toHaveLength(1);
    expect(list1[0].name).toBe('Salon1');
    expect(list2[0].name).toBe('Salon2');
  });

  it('getMaster in tenant A does not see master record from tenant B', async () => {
    const kv = makeMockKv();
    const ctx1 = makeCtx(kv, 't_salon1');
    const ctx2 = makeCtx(kv, 't_salon2');
    await saveMaster(ctx1, 333, { ...masterData, chatId: 333, name: 'OnlyInA' });
    expect(await getMaster(ctx1, 333)).not.toBeNull();
    expect(await getMaster(ctx2, 333)).toBeNull();
  });

  it('same chatId can be master in two different tenants (different salons)', async () => {
    const kv = makeMockKv();
    const ctx1 = makeCtx(kv, 't_salon1');
    const ctx2 = makeCtx(kv, 't_salon2');
    await saveMaster(ctx1, 555, { ...masterData, chatId: 555, name: 'Multi' });
    await saveMaster(ctx2, 555, { ...masterData, chatId: 555, name: 'Multi' });
    expect(await listMasters(ctx1)).toHaveLength(1);
    expect(await listMasters(ctx2)).toHaveLength(1);
    expect((await getMaster(ctx1, 555)).name).toBe('Multi');
    expect((await getMaster(ctx2, 555)).name).toBe('Multi');
  });
});

describe('User-in-tenant requirement for adding master', () => {
  it('getUser returns null for chatId with no u: record in this tenant', async () => {
    const kv = makeMockKv();
    const ctx = makeCtx(kv, 't_salon1');
    // No u:12345 in tenant — getUser returns null
    expect(await getUser(ctx, 12345)).toBeNull();
  });

  it('getUser returns user when u:chatId exists in this tenant', async () => {
    const kv = makeMockKv();
    const ctx = makeCtx(kv, 't_salon1');
    await kvPut(ctx, 'u:999', { chatId: 999, name: 'Alice', tgUsername: 'alice' });
    const u = await getUser(ctx, 999);
    expect(u).not.toBeNull();
    expect(u.name).toBe('Alice');
  });

  it('user in tenant A is not visible to tenant B getUser', async () => {
    const kv = makeMockKv();
    const ctxA = makeCtx(kv, 't_salon1');
    const ctxB = makeCtx(kv, 't_salon2');
    await kvPut(ctxA, 'u:777', { chatId: 777, name: 'Bob' });
    expect(await getUser(ctxA, 777)).not.toBeNull();
    expect(await getUser(ctxB, 777)).toBeNull();
  });
});
