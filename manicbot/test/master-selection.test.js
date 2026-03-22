/**
 * Tests for master selection feature:
 * - getSlots() respects master's workHours and workDays
 * - loadDayAppointments() filters by masterId
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getSlots, loadDayAppointments } from '../src/services/appointments.js';
import { createMockD1 } from './helpers/mock-db.js';

const TENANT_ID = 't_salon1';

function makeCtx(db) {
  return {
    db,
    tenantId: TENANT_ID,
    prefix: `t:${TENANT_ID}:`,
    svc: [
      { id: 'classic', dur: 60, price: 80, active: true },
      { id: 'design', dur: 30, price: 50, active: true },
    ],
    svcIds: new Set(['classic', 'design']),
  };
}

function insertApt(db, apt) {
  db.prepare(
    `INSERT INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, confirmed_by, cancelled, rem_h24, rem_h2, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
  ).bind(
    apt.id, TENANT_ID, apt.chatId || 1, apt.svcId, apt.date, apt.time,
    apt.ts || Date.now(), apt.status || 'confirmed',
    apt.masterId || null, apt.confirmedBy || null,
    apt.cancelled || 0, Date.now(),
  ).run();
}

function insertMaster(db, master) {
  db.prepare(
    `INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, tg_username, on_vacation, active, added_at, work_hours, work_days)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).bind(
    TENANT_ID, master.chatId, master.name || 'Test',
    master.tgUsername || null,
    master.onVacation ? 1 : 0,
    Date.now(),
    master.workHours ? JSON.stringify(master.workHours) : null,
    master.workDays ? JSON.stringify(master.workDays) : null,
  ).run();
}

const TUESDAY = '2026-03-24';

describe('loadDayAppointments — masterId filtering', () => {
  let db, ctx;
  beforeEach(() => {
    db = createMockD1();
    ctx = makeCtx(db);
  });

  it('returns all active apts when masterId is null', async () => {
    insertApt(db, { id: 'ap1', masterId: 111, date: '2026-03-17', time: '10:00', svcId: 'classic' });
    insertApt(db, { id: 'ap2', masterId: 222, date: '2026-03-17', time: '11:00', svcId: 'classic' });
    const apts = await loadDayAppointments(ctx, '2026-03-17', null);
    expect(apts.length).toBe(2);
  });

  it('filters to specific master when masterId provided', async () => {
    insertApt(db, { id: 'ap1', masterId: 111, date: '2026-03-17', time: '10:00', svcId: 'classic' });
    insertApt(db, { id: 'ap2', masterId: 222, date: '2026-03-17', time: '11:00', svcId: 'classic' });
    insertApt(db, { id: 'ap3', masterId: null, confirmedBy: 111, date: '2026-03-17', time: '12:00', svcId: 'classic' });
    const apts = await loadDayAppointments(ctx, '2026-03-17', 111);
    expect(apts.length).toBe(2);
    expect(apts.every(a => a.masterId === 111 || a.confirmedBy === 111)).toBe(true);
  });

  it('excludes cancelled appointments', async () => {
    insertApt(db, { id: 'ap1', masterId: 111, date: '2026-03-17', time: '10:00', svcId: 'classic', cancelled: 1 });
    insertApt(db, { id: 'ap2', masterId: 111, date: '2026-03-17', time: '11:00', svcId: 'classic' });
    const apts = await loadDayAppointments(ctx, '2026-03-17', 111);
    expect(apts.length).toBe(1);
    expect(apts[0].id).toBe('ap2');
  });
});

describe('getSlots — master schedule', () => {
  let db, ctx;
  beforeEach(() => {
    db = createMockD1();
    ctx = makeCtx(db);
  });

  it('returns slots within global work hours when no master specified', async () => {
    const slots = await getSlots(ctx, '2099-06-15', 'design', null);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const [h] = s.split(':').map(Number);
      expect(h).toBeGreaterThanOrEqual(9);
      expect(h).toBeLessThan(19);
    }
  });

  it('returns empty when master not found', async () => {
    const slots = await getSlots(ctx, '2099-06-15', 'classic', 999);
    expect(slots).toEqual([]);
  });

  it('returns empty when master is on vacation', async () => {
    insertMaster(db, { chatId: 111, name: 'Alice', onVacation: true });
    const slots = await getSlots(ctx, '2099-06-15', 'classic', 111);
    expect(slots).toEqual([]);
  });

  it('respects master custom workHours', async () => {
    insertMaster(db, { chatId: 111, name: 'Alice', onVacation: false, workHours: { from: 14, to: 16 } });
    const slots = await getSlots(ctx, '2099-06-15', 'design', 111);
    expect(slots.length).toBe(4);
    expect(slots[0]).toBe('14:00');
    expect(slots[slots.length - 1]).toBe('15:30');
  });

  it('returns empty on days master does not work', async () => {
    insertMaster(db, { chatId: 111, name: 'Alice', onVacation: false, workDays: [1, 3] });
    const slots = await getSlots(ctx, TUESDAY, 'classic', 111);
    expect(slots).toEqual([]);
  });

  it('returns slots on days master works', async () => {
    insertMaster(db, { chatId: 111, name: 'Alice', onVacation: false, workDays: [1, 2, 3] });
    const slots = await getSlots(ctx, TUESDAY, 'design', 111);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('master 111 booked slot is blocked for master 111 but not for master 222', async () => {
    const DATE = '2099-06-15';
    insertMaster(db, { chatId: 111, name: 'Alice', onVacation: false });
    insertMaster(db, { chatId: 222, name: 'Bob', onVacation: false });
    insertApt(db, { id: 'ap1', masterId: 111, date: DATE, time: '10:00', svcId: 'classic' });
    const slotsM111 = await getSlots(ctx, DATE, 'design', 111);
    const slotsM222 = await getSlots(ctx, DATE, 'design', 222);
    expect(slotsM111).not.toContain('10:00');
    expect(slotsM111).not.toContain('10:30');
    expect(slotsM222).toContain('10:00');
    expect(slotsM222).toContain('10:30');
  });
});
