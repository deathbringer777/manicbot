/**
 * Tests for master save/list KV consistency bug.
 *
 * Bug: Cloudflare KV kv.list() is eventually consistent — a key written with
 * kv.put() may NOT appear in a subsequent kv.list() call within the same request.
 * listMasters() used kv.list() → showed empty list right after saveMaster().
 *
 * Fix: saveMaster() also writes a master:__index key (array of chatIds).
 *      listMasters() reads the index via kvGet (kv.get — immediately consistent),
 *      then fetches each master individually. kv.list() is used only as fallback
 *      for legacy data that predates the index.
 */

import { describe, it, expect } from 'vitest';
import { saveMaster, deleteMaster, listMasters, getMaster, isMaster } from '../src/services/users.js';

/**
 * Mock KV that simulates the Cloudflare KV consistency issue:
 * put() + get() is consistent, but put() + list() may not be (list is async/delayed).
 */
function makeMockKvWithConsistencyBug() {
  const store = new Map();
  return {
    _store: store,
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
    // list() returns EMPTY — simulates eventual consistency lag
    list: async () => ({ keys: [], list_complete: true }),
  };
}

function makeMockKvFull() {
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

function makeCtx(kv, tenantId = 't_salon2') {
  return { kv, prefix: `t:${tenantId}:` };
}

const masterData = {
  chatId: 111,
  name: 'Test Master',
  tgUsername: 'testmaster',
  phone: null,
  addedAt: Date.now(),
  active: true,
};

describe('listMasters — KV list() consistency bug', () => {
  it('BUG CASE: listMasters returns empty when kv.list() is stale after saveMaster', async () => {
    // This test documents the old broken behavior
    const kv = makeMockKvWithConsistencyBug(); // list() always returns empty
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 111, { ...masterData });
    const masters = await listMasters(ctx);
    // With the fix, even though list() is stale, the index-based lookup works
    expect(masters.length).toBe(1);
    expect(masters[0].chatId).toBe(111);
  });

  it('FIXED: listMasters finds master via index even when kv.list() returns empty', async () => {
    const kv = makeMockKvWithConsistencyBug();
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 222, { ...masterData, chatId: 222, name: 'Master Two' });
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].name).toBe('Master Two');
  });
});

describe('saveMaster + listMasters — full CRUD', () => {
  it('can add and list multiple masters', async () => {
    const kv = makeMockKvFull();
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 100, { ...masterData, chatId: 100, name: 'Alice' });
    await saveMaster(ctx, 200, { ...masterData, chatId: 200, name: 'Bob' });
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(2);
    const names = masters.map(m => m.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  it('getMaster returns correct data after save', async () => {
    const kv = makeMockKvFull();
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 300, { ...masterData, chatId: 300, name: 'Charlie' });
    const m = await getMaster(ctx, 300);
    expect(m).not.toBeNull();
    expect(m.name).toBe('Charlie');
  });

  it('isMaster returns true after save', async () => {
    const kv = makeMockKvFull();
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 400, { ...masterData, chatId: 400 });
    expect(await isMaster(ctx, 400)).toBe(true);
    expect(await isMaster(ctx, 999)).toBe(false);
  });

  it('deleteMaster removes from list', async () => {
    const kv = makeMockKvFull();
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 500, { ...masterData, chatId: 500, name: 'Dave' });
    await saveMaster(ctx, 600, { ...masterData, chatId: 600, name: 'Eve' });
    await deleteMaster(ctx, 500);
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].name).toBe('Eve');
    expect(await isMaster(ctx, 500)).toBe(false);
  });

  it('deleteMaster does not remove other masters from list', async () => {
    const kv = makeMockKvWithConsistencyBug(); // even with list() broken
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 700, { ...masterData, chatId: 700, name: 'Frank' });
    await saveMaster(ctx, 800, { ...masterData, chatId: 800, name: 'Grace' });
    await deleteMaster(ctx, 700);
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].name).toBe('Grace');
  });

  it('updating master (vacation toggle) is reflected immediately via index', async () => {
    const kv = makeMockKvWithConsistencyBug();
    const ctx = makeCtx(kv);
    await saveMaster(ctx, 900, { ...masterData, chatId: 900, name: 'Henry', onVacation: false });
    // Update: toggle vacation
    const m = await getMaster(ctx, 900);
    m.onVacation = true;
    await saveMaster(ctx, 900, m);
    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].onVacation).toBe(true);
  });

  it('masters are scoped to tenant — different tenants have separate lists', async () => {
    const kv = makeMockKvFull();
    const ctx1 = makeCtx(kv, 't_salon1');
    const ctx2 = makeCtx(kv, 't_salon2');
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
