/**
 * C1 — saveApt's ON CONFLICT semantics on a REAL D1 (miniflare SQLite).
 *
 * The bespoke mock (test/helpers/mock-db.js) models the migration-0097 partial
 * index by hand; that is exactly why the C1 defect (an ON CONFLICT target that
 * no longer matched the real index) survived until a manual audit. This test
 * runs the actual INSERT … ON CONFLICT against the REAL 0097 index on the same
 * SQLite engine production D1 uses, so a future target/index drift fails here
 * at prepare time instead of 500-ing every booking in prod.
 *
 * DDL is injected by vitest.d1.config.mjs, sliced from the authoritative
 * schema.sql (the real index, not a copy). Run via `npm run test:d1`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { saveApt, SLOT_TAKEN } from '../src/services/appointments.js';

// eslint-disable-next-line no-undef -- injected via config `define`
const DDL = __BOOKING_DDL__;

beforeAll(async () => {
  // Apply each DDL statement individually — D1.exec() splits on newlines and
  // would mangle multi-line CREATE TABLE, but prepare().run() runs one whole
  // (multi-line) statement faithfully.
  for (const stmt of DDL) {
    await env.DB.prepare(stmt).run();
  }
});

function ctx(tenantId) {
  return { db: env.DB, tenantId };
}

const SLOT = { svcId: 'classic', date: '2026-09-12', time: '11:00' };
const future = () => Date.now() + 3_600_000;

describe('saveApt — real-D1 ON CONFLICT against the 0097 partial index (C1)', () => {
  it('applied the real 0097 partial unique index', async () => {
    const row = await env.DB
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_apt_unique_active_slot'",
      )
      .first();
    expect(row?.sql).toBeTruthy();
    // The predicate the ON CONFLICT target MUST match (regression anchor).
    expect(row.sql).toMatch(/master_id IS NOT NULL/i);
  });

  it('first INSERT wins; a second identical ASSIGNED-master slot returns SLOT_TAKEN', async () => {
    const c = ctx('t_real_dbl');
    const a = await saveApt(c, {
      ...SLOT, masterId: 5, chatId: 1001, ts: future(), userName: 'A', userPhone: '+1',
    });
    expect(a).not.toBe(SLOT_TAKEN);
    expect(a?.id).toMatch(/^a/);

    const b = await saveApt(c, {
      ...SLOT, masterId: 5, chatId: 1002, ts: future(), userName: 'B', userPhone: '+2',
    });
    // Real ON CONFLICT DO NOTHING ⇒ changes()===0 ⇒ SLOT_TAKEN (no throw, no 500).
    expect(b).toBe(SLOT_TAKEN);
  });

  it('UNASSIGNED (no-master) bookings at the same slot may overlap — outside the partial index', async () => {
    const c = ctx('t_real_unassigned');
    const a = await saveApt(c, {
      ...SLOT, chatId: 1, ts: future(), userName: 'X', userPhone: '+x',
    });
    const b = await saveApt(c, {
      ...SLOT, chatId: 2, ts: future(), userName: 'Y', userPhone: '+y',
    });
    expect(a).not.toBe(SLOT_TAKEN);
    // master_id IS NULL ⇒ outside `WHERE ... master_id IS NOT NULL` ⇒ no conflict.
    expect(b).not.toBe(SLOT_TAKEN);
  });
});
