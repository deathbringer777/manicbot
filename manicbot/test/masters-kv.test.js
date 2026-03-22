/**
 * Tests for master CRUD — now using D1 (strongly consistent, no KV list() bugs).
 */

import { describe, it, expect } from 'vitest';
import { saveMaster, deleteMaster, listMasters, getMaster, isMaster } from '../src/services/users.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx(tenantId = 't_salon2') {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, prefix: `t:${tenantId}:`, tenantId };
}

const masterData = {
  chatId: 111,
  name: 'Test Master',
  tgUsername: 'testmaster',
  phone: null,
  addedAt: Date.now(),
  active: true,
};

describe('saveMaster + listMasters — D1 CRUD', () => {
  it('can add and list multiple masters', async () => {
    const ctx = makeCtx();
    await saveMaster(ctx, 100, { ...masterData, chatId: 100, name: 'Alice' });
    await saveMaster(ctx, 200, { ...masterData, chatId: 200, name: 'Bob' });
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(2);
    const names = masters.map(m => m.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  it('getMaster returns correct data after save', async () => {
    const ctx = makeCtx();
    await saveMaster(ctx, 300, { ...masterData, chatId: 300, name: 'Charlie' });
    const m = await getMaster(ctx, 300);
    expect(m).not.toBeNull();
    expect(m.name).toBe('Charlie');
  });

  it('isMaster returns true after save', async () => {
    const ctx = makeCtx();
    await saveMaster(ctx, 400, { ...masterData, chatId: 400 });
    expect(await isMaster(ctx, 400)).toBe(true);
    expect(await isMaster(ctx, 999)).toBe(false);
  });

  it('deleteMaster removes from list', async () => {
    const ctx = makeCtx();
    await saveMaster(ctx, 500, { ...masterData, chatId: 500, name: 'Dave' });
    await saveMaster(ctx, 600, { ...masterData, chatId: 600, name: 'Eve' });
    await deleteMaster(ctx, 500);
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].name).toBe('Eve');
    expect(await isMaster(ctx, 500)).toBe(false);
  });

  it('updating master (vacation toggle) is reflected immediately', async () => {
    const ctx = makeCtx();
    await saveMaster(ctx, 900, { ...masterData, chatId: 900, name: 'Henry', onVacation: false });
    const m = await getMaster(ctx, 900);
    m.onVacation = true;
    await saveMaster(ctx, 900, m);
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].onVacation).toBe(true);
  });

  it('masters are scoped to tenant — different tenants have separate lists', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveMaster(ctx1, 111, { ...masterData, chatId: 111, name: 'Salon1 Master' });
    await saveMaster(ctx2, 222, { ...masterData, chatId: 222, name: 'Salon2 Master' });
    const salon1Masters = await listMasters(ctx1);
    const salon2Masters = await listMasters(ctx2);
    expect(salon1Masters.length).toBe(1);
    expect(salon1Masters[0].name).toBe('Salon1 Master');
    expect(salon2Masters.length).toBe(1);
    expect(salon2Masters[0].name).toBe('Salon2 Master');
  });
});
