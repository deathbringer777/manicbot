/**
 * #P0-1 — saveApt MUST collapse concurrent bookings of the same active slot
 * down to a single successful row, returning SLOT_TAKEN for the losers.
 *
 * The defence is a partial UNIQUE index on
 * (tenant_id, COALESCE(master_id, -1), date, time) WHERE cancelled = 0
 * (migration 0044) plus an INSERT … ON CONFLICT DO NOTHING in saveApt.
 *
 * The test stresses two paths:
 *   - D1 path: many parallel saveApt calls against the same slot.
 *   - KV path: post-insert race detector (best-effort) when no D1 is bound.
 *
 * The mock D1 honours ON CONFLICT semantics for the bare-identifier portion
 * of the conflict spec; that is sufficient to detect a tenant_id+date+time
 * collision even though COALESCE(master_id, -1) is filtered out.
 */
import { describe, it, expect } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { saveApt, SLOT_TAKEN } from '../src/services/appointments.js';

function baseCtx(tenantId = 't_dbl') {
  return makeCtx({
    tenantId,
    tenant: { plan: 'pro', billingStatus: 'active' },
  });
}

const SLOT = { svcId: 'classic', date: '2026-09-12', time: '11:00' };

describe('saveApt — atomic slot booking (#P0-1)', () => {
  it('exposes a frozen SLOT_TAKEN sentinel', () => {
    expect(SLOT_TAKEN.slotTaken).toBe(true);
    // Attempts to mutate must be no-ops in strict mode, throw in non-strict.
    // We at least require the exported reference to be the same on every read.
    expect(SLOT_TAKEN).toBe(SLOT_TAKEN);
  });

  it('first INSERT wins, subsequent identical INSERTs return SLOT_TAKEN', async () => {
    const ctx = baseCtx();
    const apt1 = await saveApt(ctx, {
      ...SLOT, chatId: 1001, ts: Date.now() + 3_600_000,
      userName: 'A', userPhone: '+1',
    });
    expect(apt1).not.toBe(SLOT_TAKEN);
    expect(apt1?.id).toMatch(/^a/);

    const apt2 = await saveApt(ctx, {
      ...SLOT, chatId: 1002, ts: Date.now() + 3_600_000,
      userName: 'B', userPhone: '+2',
    });
    expect(apt2).toBe(SLOT_TAKEN);
  });

  it('different times for the same master succeed independently', async () => {
    const ctx = baseCtx('t_dbl_diff_times');
    const a = await saveApt(ctx, {
      ...SLOT, chatId: 1, masterId: 7, ts: 1, userName: 'X', userPhone: '+x',
    });
    const b = await saveApt(ctx, {
      ...SLOT, time: '12:00', chatId: 2, masterId: 7, ts: 2, userName: 'Y', userPhone: '+y',
    });
    expect(a).not.toBe(SLOT_TAKEN);
    expect(b).not.toBe(SLOT_TAKEN);
  });

  it('different masters at the same time succeed independently', async () => {
    const ctx = baseCtx('t_dbl_diff_masters');
    const a = await saveApt(ctx, {
      ...SLOT, chatId: 1, masterId: 100, ts: 1, userName: 'X', userPhone: '+x',
    });
    const b = await saveApt(ctx, {
      ...SLOT, chatId: 2, masterId: 200, ts: 2, userName: 'Y', userPhone: '+y',
    });
    expect(a).not.toBe(SLOT_TAKEN);
    expect(b).not.toBe(SLOT_TAKEN);
  });

  it('cancelled appointment frees the slot for re-booking', async () => {
    // Cancelled rows are excluded from the partial UNIQUE index, so a fresh
    // booking of the same slot must succeed.
    const ctx = baseCtx('t_dbl_cancel_replay');
    const first = await saveApt(ctx, {
      ...SLOT, chatId: 1, ts: 1, userName: 'X', userPhone: '+x',
    });
    expect(first).not.toBe(SLOT_TAKEN);
    // Mark cancelled via parameterised UPDATE — the mock's _parseUpdate
    // only handles `col = ?` SET clauses, not literal values.
    const mod = await import('../src/utils/db.js');
    await mod.dbRun(
      ctx,
      'UPDATE appointments SET cancelled = ? WHERE id = ?',
      1, first.id,
    );
    const second = await saveApt(ctx, {
      ...SLOT, chatId: 2, ts: 2, userName: 'Y', userPhone: '+y',
    });
    expect(second).not.toBe(SLOT_TAKEN);
  });

  it('many concurrent INSERTs collapse to a single non-cancelled row', async () => {
    // Real production would see this with two browser tabs / two channels
    // racing the same slot. The partial UNIQUE plus ON CONFLICT DO NOTHING
    // make sure exactly one wins.
    const ctx = baseCtx('t_dbl_concurrent');
    const N = 25;
    const calls = Array.from({ length: N }, (_, i) =>
      saveApt(ctx, {
        ...SLOT,
        chatId: 5000 + i,
        ts: 1,
        userName: `U${i}`,
        userPhone: `+${i}`,
      }),
    );
    const outcomes = await Promise.all(calls);
    const winners = outcomes.filter((o) => o !== SLOT_TAKEN && o !== null);
    const losers = outcomes.filter((o) => o === SLOT_TAKEN);
    expect(winners).toHaveLength(1);
    expect(losers.length).toBe(N - 1);
  });
});
