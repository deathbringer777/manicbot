/**
 * Tests for master selection feature:
 * - getSlots() respects master's workHours and workDays
 * - loadDayAppointments() filters by masterId
 * - notifyAptStaff() routes to assigned master only
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSlots, loadDayAppointments } from '../src/services/appointments.js';

function makeMockKv(store = new Map()) {
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
    list: async () => ({ keys: [], list_complete: true }),
  };
}

function makeCtx(kv, overrides = {}) {
  return {
    kv,
    prefix: 't:salon1:',
    svc: [
      { id: 'classic', dur: 60, price: 80, active: true },
      { id: 'design', dur: 30, price: 50, active: true },
    ],
    svcIds: new Set(['classic', 'design']),
    ...overrides,
  };
}

// A future Tuesday: 2026-03-24
const TUESDAY = '2026-03-24'; // DOW = 2

describe('loadDayAppointments — masterId filtering', () => {
  it('returns all active apts when masterId is null', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    // Write day index and two appointments
    store.set('t:salon1:d:2026-03-17', JSON.stringify(['ap1', 'ap2']));
    store.set('t:salon1:ap:ap1', JSON.stringify({ id: 'ap1', masterId: 111, date: '2026-03-17', time: '10:00', svcId: 'classic', cx: false }));
    store.set('t:salon1:ap:ap2', JSON.stringify({ id: 'ap2', masterId: 222, date: '2026-03-17', time: '11:00', svcId: 'classic', cx: false }));
    const apts = await loadDayAppointments(ctx, '2026-03-17', null);
    expect(apts.length).toBe(2);
  });

  it('filters to specific master when masterId provided', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    store.set('t:salon1:d:2026-03-17', JSON.stringify(['ap1', 'ap2', 'ap3']));
    store.set('t:salon1:ap:ap1', JSON.stringify({ id: 'ap1', masterId: 111, date: '2026-03-17', time: '10:00', svcId: 'classic', cx: false }));
    store.set('t:salon1:ap:ap2', JSON.stringify({ id: 'ap2', masterId: 222, date: '2026-03-17', time: '11:00', svcId: 'classic', cx: false }));
    store.set('t:salon1:ap:ap3', JSON.stringify({ id: 'ap3', masterId: null, confirmedBy: 111, date: '2026-03-17', time: '12:00', svcId: 'classic', cx: false }));
    const apts = await loadDayAppointments(ctx, '2026-03-17', 111);
    expect(apts.length).toBe(2);
    expect(apts.every(a => a.masterId === 111 || a.confirmedBy === 111)).toBe(true);
  });

  it('excludes cancelled appointments', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    store.set('t:salon1:d:2026-03-17', JSON.stringify(['ap1', 'ap2']));
    store.set('t:salon1:ap:ap1', JSON.stringify({ id: 'ap1', masterId: 111, date: '2026-03-17', time: '10:00', svcId: 'classic', cx: true }));
    store.set('t:salon1:ap:ap2', JSON.stringify({ id: 'ap2', masterId: 111, date: '2026-03-17', time: '11:00', svcId: 'classic', cx: false }));
    const apts = await loadDayAppointments(ctx, '2026-03-17', 111);
    expect(apts.length).toBe(1);
    expect(apts[0].id).toBe('ap2');
  });
});

describe('getSlots — master schedule', () => {
  // Mock getMaster inside users.js — getSlots imports it
  // We'll write master data to KV instead since getMaster reads from KV

  it('returns slots within global work hours when no master specified', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    // Use a future date so "past time" filter doesn't cut slots
    const slots = await getSlots(ctx, '2099-06-15', 'design', null);
    // design is 30min, global 9-19 → plenty of slots
    expect(slots.length).toBeGreaterThan(0);
    // All slots should be within 09:00-19:00
    for (const s of slots) {
      const [h] = s.split(':').map(Number);
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(19);
    }
  });

  it('returns empty when master not found in KV', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    const slots = await getSlots(ctx, '2099-06-15', 'classic', 999);
    expect(slots).toEqual([]);
  });

  it('returns empty when master is on vacation', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    store.set('t:salon1:master:111', JSON.stringify({ chatId: 111, name: 'Alice', onVacation: true }));
    const slots = await getSlots(ctx, '2099-06-15', 'classic', 111);
    expect(slots).toEqual([]);
  });

  it('respects master custom workHours', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    store.set('t:salon1:master:111', JSON.stringify({ chatId: 111, name: 'Alice', onVacation: false, workHours: { from: 14, to: 16 } }));
    const slots = await getSlots(ctx, '2099-06-15', 'design', 111);
    // design = 30min, 14:00-16:00 → 14:00, 14:30, 15:00, 15:30
    expect(slots.length).toBe(4);
    expect(slots[0]).toBe('14:00');
    expect(slots[slots.length - 1]).toBe('15:30');
  });

  it('returns empty on days master does not work', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    // TUESDAY is DOW=2, master only works Mon(1) + Wed(3)
    store.set('t:salon1:master:111', JSON.stringify({ chatId: 111, name: 'Alice', onVacation: false, workDays: [1, 3] }));
    const slots = await getSlots(ctx, TUESDAY, 'classic', 111);
    expect(slots).toEqual([]);
  });

  it('returns slots on days master works', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    // TUESDAY is DOW=2, master works Mon(1)+Tue(2)+Wed(3)
    store.set('t:salon1:master:111', JSON.stringify({ chatId: 111, name: 'Alice', onVacation: false, workDays: [1, 2, 3] }));
    const slots = await getSlots(ctx, TUESDAY, 'design', 111);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('master 111 booked slot is blocked for master 111 but not for master 222', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctx = makeCtx(kv);
    const DATE = '2099-06-15';
    store.set('t:salon1:master:111', JSON.stringify({ chatId: 111, name: 'Alice', onVacation: false }));
    store.set('t:salon1:master:222', JSON.stringify({ chatId: 222, name: 'Bob', onVacation: false }));
    // Book 10:00 classic (60min) for master 111
    store.set(`t:salon1:d:${DATE}`, JSON.stringify(['ap1']));
    store.set('t:salon1:ap:ap1', JSON.stringify({ id: 'ap1', masterId: 111, date: DATE, time: '10:00', svcId: 'classic', cx: false }));
    const slotsM111 = await getSlots(ctx, DATE, 'design', 111);
    const slotsM222 = await getSlots(ctx, DATE, 'design', 222);
    // Master 111's 10:00-11:00 is blocked for them
    expect(slotsM111).not.toContain('10:00');
    expect(slotsM111).not.toContain('10:30');
    // Master 222 is unaffected — their schedule is independent
    expect(slotsM222).toContain('10:00');
    expect(slotsM222).toContain('10:30');
  });
});
