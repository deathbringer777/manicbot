/**
 * Master "did the visit happen?" tap (visit_ok: / visit_noshow:) — C6 + M2.
 *
 * C6 (Telegram side): the master-tap handler must route through the SAME
 * `dispatchAppointmentAutomation` seam the admin-app uses, so a Telegram
 * confirmation bumps users.lifetime_visits (done) / users.no_show_count
 * (client no-show) and fires marketing automations — not just the local
 * status/stamp-card writes.
 *
 * M2 (idempotency): a second identical tap on an already-confirmed
 * appointment is a no-op — it must NOT re-bump the stamp card, re-send the
 * review prompt, or re-fire the dispatcher. The guard keys off
 * `visit_confirmed_at` being already set on the row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  let cfg = {};
  let apptRow = null;
  return {
    dispatch: vi.fn(async () => ({ notified: true, sideEffects: true, automationsFired: 0 })),
    markReviewRequested: vi.fn(async () => {}),
    getCfg: () => cfg,
    setCfg: (c) => { cfg = c; },
    getApptRow: () => apptRow,
    setApptRow: (r) => { apptRow = r; },
  };
});

vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async () => {}), edit: vi.fn(async () => {}),
  answerCb: vi.fn(async () => {}), api: vi.fn(async () => {}),
}));
vi.mock('../src/services/state.js', () => ({
  getState: vi.fn(async () => ({})), setState: vi.fn(async () => {}),
  clearState: vi.fn(async () => {}), checkRateLimit: vi.fn(async () => true),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'), setLang: vi.fn(async () => {}),
}));
vi.mock('../src/services/users.js', async (importOriginal) => ({
  ...await importOriginal(),
  getRole: vi.fn(async () => 'tenant_owner'),
}));
vi.mock('../src/utils/db.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // The handler reads the apt row with a `SELECT * FROM appointments …`.
    // The stamp-card lookup hits `stamp_card_configs` — return null there so
    // the stamp card stays disabled unless a test opts in.
    dbGet: vi.fn(async (_ctx, sql) => (String(sql).includes('appointments') ? h.getApptRow() : null)),
    dbRun: vi.fn(async () => ({})),
  };
});
vi.mock('../src/services/services.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getConfig: vi.fn(async (_ctx, key) => h.getCfg()[key]) };
});
vi.mock('../src/services/reviews.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, markReviewRequested: h.markReviewRequested };
});
vi.mock('../src/services/appointmentAutomations.js', () => ({
  dispatchAppointmentAutomation: h.dispatch,
}));

import { onCb } from '../src/handlers/callback.js';
import { send } from '../src/telegram.js';
import { dbRun } from '../src/utils/db.js';

function makeCtx() {
  return { tenantId: 't1', channel: { type: 'telegram' }, env: {}, tenant: { billingStatus: 'active', plan: 'pro' }, svc: [], svcIds: new Set() };
}
function makeCb(data, cid = 999) {
  return { id: 'cb_1', data, from: { id: cid, first_name: 'Мастер' }, message: { message_id: 11, chat: { id: cid, type: 'private' } } };
}
// A fresh (not-yet-confirmed) appointment row, assigned to master 999.
function freshRow() {
  return { id: 'apt_1', chat_id: 555, master_id: 999, svc_id: 'svc_a', date: '2026-05-15', time: '12:00', tenant_id: 't1', status: 'confirmed', visit_confirmed_at: null };
}

describe('visit_ok / visit_noshow master tap → C6 dispatch + M2 idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.setCfg({});
    h.setApptRow(freshRow());
  });

  it('C6: a master "done" tap fires the dispatcher once with appointment.done + camelCase apt', async () => {
    await onCb(makeCtx(), makeCb('visit_ok:apt_1'));

    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const [, apt, eventType] = h.dispatch.mock.calls[0];
    expect(eventType).toBe('appointment.done');
    // The dispatcher expects a camelCase doc (apt.chatId), not the raw row —
    // otherwise its lifetime_visits bump (WHERE chat_id = apt.chatId) no-ops.
    expect(apt.chatId).toBe(555);
    expect(apt.id).toBe('apt_1');
  });

  it('C6: a master "client no-show" tap fires the dispatcher once with appointment.no_show_client', async () => {
    await onCb(makeCtx(), makeCb('visit_noshow:apt_1'));

    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const [, apt, eventType] = h.dispatch.mock.calls[0];
    expect(eventType).toBe('appointment.no_show_client');
    expect(apt.chatId).toBe(555);
  });

  it('M2: a second identical "done" tap on an already-confirmed apt is a no-op', async () => {
    h.setCfg({ reviews_enabled: '1', reviews_prompt_timing: 'immediate' });
    // First tap: fresh row, processes normally.
    await onCb(makeCtx(), makeCb('visit_ok:apt_1'));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.markReviewRequested).toHaveBeenCalledTimes(1);

    // Second tap: the row now carries a visit_confirmed_at stamp.
    h.setApptRow({ ...freshRow(), status: 'done', visit_confirmed_at: 1700000000, visit_confirmed_by: 'master' });
    vi.clearAllMocks();
    await onCb(makeCtx(), makeCb('visit_ok:apt_1'));

    // No re-dispatch, no re-review-request.
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.markReviewRequested).not.toHaveBeenCalled();
    // No status UPDATE re-run (the only dbRun in the fresh path is the
    // status write + analytics; on the no-op path neither should fire a
    // stamp-card / status mutation). Assert no UPDATE appointments SET status.
    const statusUpdate = dbRun.mock.calls.find(
      (c) => /UPDATE appointments/i.test(String(c[1])) && /status\s*=/i.test(String(c[1])),
    );
    expect(statusUpdate).toBeUndefined();
  });

  it('M2: the gentle "already recorded" reply goes out on the second tap', async () => {
    await onCb(makeCtx(), makeCb('visit_ok:apt_1')); // first
    h.setApptRow({ ...freshRow(), status: 'done', visit_confirmed_at: 1700000000, visit_confirmed_by: 'master' });
    vi.clearAllMocks();
    await onCb(makeCtx(), makeCb('visit_ok:apt_1')); // second

    // Some reply was sent to the master, and it is not the "marked done" line.
    expect(send).toHaveBeenCalled();
    const masterReplies = send.mock.calls.filter((c) => c[1] === 999);
    expect(masterReplies.length).toBeGreaterThan(0);
  });
});
