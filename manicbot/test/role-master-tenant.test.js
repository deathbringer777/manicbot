/**
 * Tests: master assignment scoped to tenant, user visibility.
 */

import { describe, it, expect } from 'vitest';
import { saveMaster, listMasters, getMaster, deleteMaster, getUser, saveUser } from '../src/services/users.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx(tenantId = 't_salon1') {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, prefix: `t:${tenantId}:`, tenantId };
}

const masterData = {
  chatId: 111,
  name: 'Test',
  tgUsername: null,
  phone: null,
  addedAt: Date.now(),
  active: true,
};

describe('Master assignment — tenant isolation (D1)', () => {
  it('masters are stored under tenant (listMasters only sees own tenant)', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
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
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveMaster(ctx1, 333, { ...masterData, chatId: 333, name: 'OnlyInA' });
    expect(await getMaster(ctx1, 333)).not.toBeNull();
    expect(await getMaster(ctx2, 333)).toBeNull();
  });

  it('same chatId can be master in two different tenants', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveMaster(ctx1, 555, { ...masterData, chatId: 555, name: 'Multi' });
    await saveMaster(ctx2, 555, { ...masterData, chatId: 555, name: 'Multi' });
    expect(await listMasters(ctx1)).toHaveLength(1);
    expect(await listMasters(ctx2)).toHaveLength(1);
  });
});

describe('User-in-tenant requirement (D1)', () => {
  it('getUser returns null for chatId with no record in this tenant', async () => {
    const ctx = makeCtx();
    expect(await getUser(ctx, 12345)).toBeNull();
  });

  it('getUser returns user when record exists in this tenant', async () => {
    const ctx = makeCtx();
    await saveUser(ctx, 999, { chatId: 999, name: 'Alice', tgUsername: 'alice' });
    const u = await getUser(ctx, 999);
    expect(u).not.toBeNull();
    expect(u.name).toBe('Alice');
  });

  it('user in tenant A is not visible to tenant B getUser', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctxB = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveUser(ctxA, 777, { chatId: 777, name: 'Bob' });
    expect(await getUser(ctxA, 777)).not.toBeNull();
    expect(await getUser(ctxB, 777)).toBeNull();
  });
});
