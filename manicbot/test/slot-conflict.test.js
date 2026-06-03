/**
 * P0 — Slot conflict detection.
 *
 * The audit found NO direct test of overlap behavior in getSlots(): a regression
 * here would silently double-book customers (two appointments at the same time
 * for the same master). This test pins down the contract:
 *
 *  1. Overlapping booked slot is excluded from available slots
 *  2. Back-to-back appointments DO NOT conflict (10:00–11:00 + 11:00–12:00 OK)
 *  3. Cancelled appointments DO NOT block (status='cancelled' freed slot)
 *  4. Different master, same time: NO conflict (per-master calendars)
 *  5. Partial overlap (start before / end after) is detected
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getSlots } from '../src/services/appointments.js';
import { createMockD1 } from './helpers/mock-db.js';

const TENANT_ID = 't_slot_conflict';

function makeCtx(db) {
  return {
    db,
    tenantId: TENANT_ID,
    prefix: `t:${TENANT_ID}:`,
    svc: [
      { id: 'classic', dur: 60, price: 80, active: true },
      { id: 'gel', dur: 90, price: 120, active: true },
    ],
    svcIds: new Set(['classic', 'gel']),
  };
}

function insertApt(db, apt) {
  db.prepare(
    `INSERT INTO appointments (id, tenant_id, chat_id, svc_id, date, time, ts, status, master_id, confirmed_by, cancelled, rem_h24, rem_h2, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
  ).bind(
    apt.id, TENANT_ID, apt.chatId || 1, apt.svcId, apt.date, apt.time,
    apt.ts || Date.now(), apt.status || 'confirmed',
    apt.masterId || null, apt.confirmedBy || null,
    apt.cancelled ? 1 : 0, Date.now(),
  ).run();
}

function insertMaster(db, master) {
  db.prepare(
    `INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, tg_username, on_vacation, active, added_at, work_hours, work_days)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(
    TENANT_ID, master.chatId, master.name || 'Test',
    null, 0, Date.now(),
    JSON.stringify({ from: 9, to: 18 }),
    JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
  ).run();
}

// Pick a Tuesday ~30 days out so today's "past slot" filter doesn't interfere.
const _d = new Date();
_d.setUTCDate(_d.getUTCDate() + 30);
while (_d.getUTCDay() !== 2) _d.setUTCDate(_d.getUTCDate() + 1);
const FUTURE_DATE = _d.toISOString().slice(0, 10);

describe('slot conflict — getSlots() overlap behavior (P0)', () => {
  let db, ctx;

  beforeEach(() => {
    db = createMockD1();
    ctx = makeCtx(db);
    insertMaster(db, { chatId: 100, name: 'Anna' });
    insertMaster(db, { chatId: 200, name: 'Maria' });
  });

  it('overlapping booked slot is excluded from available slots', async () => {
    insertApt(db, { id: 'a1', svcId: 'classic', date: FUTURE_DATE, time: '10:00', masterId: 100 });
    const slots = await getSlots(ctx, FUTURE_DATE, 'classic', 100);
    // 10:00 booking spans 10:00-11:00; 09:30+60min would end 10:30 (overlaps); 10:00 starts in middle
    expect(slots).not.toContain('09:30'); // 09:30-10:30 overlaps 10:00-11:00
    expect(slots).not.toContain('10:00'); // exact overlap
    expect(slots).not.toContain('10:30'); // 10:30-11:30 overlaps 10:00-11:00
  });

  it('back-to-back appointments are NOT a conflict', async () => {
    insertApt(db, { id: 'a1', svcId: 'classic', date: FUTURE_DATE, time: '10:00', masterId: 100 });
    const slots = await getSlots(ctx, FUTURE_DATE, 'classic', 100);
    // 09:00-10:00 ends EXACTLY when 10:00-11:00 starts — should be allowed
    expect(slots).toContain('09:00');
    // 11:00-12:00 starts EXACTLY when 10:00-11:00 ends — should be allowed
    expect(slots).toContain('11:00');
  });

  it('cancelled appointments do NOT block slots', async () => {
    insertApt(db, { id: 'a_cancelled', svcId: 'classic', date: FUTURE_DATE, time: '10:00', masterId: 100, cancelled: true });
    const slots = await getSlots(ctx, FUTURE_DATE, 'classic', 100);
    // 10:00 should be available since the only booking there is cancelled
    expect(slots).toContain('10:00');
  });

  it('different master, same time, NO conflict', async () => {
    insertApt(db, { id: 'a1', svcId: 'classic', date: FUTURE_DATE, time: '10:00', masterId: 100 });
    // Master 200 has no booking — 10:00 should be free for them
    const slotsM2 = await getSlots(ctx, FUTURE_DATE, 'classic', 200);
    expect(slotsM2).toContain('10:00');
    expect(slotsM2).toContain('10:30');
    // Master 100 still blocked
    const slotsM1 = await getSlots(ctx, FUTURE_DATE, 'classic', 100);
    expect(slotsM1).not.toContain('10:00');
  });

  it('partial overlap (longer service across an existing slot) is detected', async () => {
    // 60-min booking at 10:30. A 90-min `gel` slot starting at 09:30 ends at 11:00 → overlaps.
    insertApt(db, { id: 'a1', svcId: 'classic', date: FUTURE_DATE, time: '10:30', masterId: 100 });
    const slots = await getSlots(ctx, FUTURE_DATE, 'gel', 100);
    expect(slots).not.toContain('09:30'); // 09:30-11:00 overlaps 10:30-11:30
    expect(slots).not.toContain('10:00'); // 10:00-11:30 overlaps
    expect(slots).not.toContain('10:30'); // exact start overlap
    // 11:30 start (11:30-13:00) is back-to-back end with 10:30-11:30; allowed
    expect(slots).toContain('11:30');
  });

  it('a booking with a corrupt (non-numeric) time is handled gracefully', async () => {
    // Contract: a corrupt row must never crash slot generation nor silently
    // mask the whole day. The Number.isFinite guard makes this explicit.
    insertApt(db, { id: 'a_bad', svcId: 'classic', date: FUTURE_DATE, time: 'xx:yy', masterId: 100 });
    const slots = await getSlots(ctx, FUTURE_DATE, 'classic', 100);
    expect(Array.isArray(slots)).toBe(true);
    // The corrupt booking is ignored, so normal slots stay available.
    expect(slots).toContain('10:00');
    expect(slots).toContain('11:00');
  });

  it('multiple bookings on same master combine to block multiple slots', async () => {
    insertApt(db, { id: 'a1', svcId: 'classic', date: FUTURE_DATE, time: '10:00', masterId: 100 });
    insertApt(db, { id: 'a2', svcId: 'classic', date: FUTURE_DATE, time: '14:00', masterId: 100 });
    const slots = await getSlots(ctx, FUTURE_DATE, 'classic', 100);
    expect(slots).not.toContain('10:00');
    expect(slots).not.toContain('14:00');
    expect(slots).toContain('09:00');
    expect(slots).toContain('12:00');
    expect(slots).toContain('15:00'); // back-to-back end of 14:00-15:00
  });
});
