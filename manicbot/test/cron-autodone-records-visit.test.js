/**
 * C6 (cron side) — Stage-2 auto-done must RECORD the visit.
 *
 * The T+24h auto-done sweep in processPostVisitConfirmations (driven via the
 * exported `phasePostVisit` wrapper) used to only flip status → 'done'. It
 * never recorded the visit, so `users.lifetime_visits` was not incremented
 * and marketing automations never fired for an auto-confirmed visit — unlike
 * the admin-app "done" action, which routes through
 * dispatchAppointmentAutomation('appointment.done').
 *
 * The fix calls the SAME dispatcher for the auto-done transition. Idempotency
 * is guaranteed upstream by the candidate query's `visit_confirmed_at IS NULL`
 * filter: once a row is auto-done (visit_confirmed_at set), it can never be
 * re-selected, so the dispatcher fires exactly once per visit.
 *
 * The Telegram-tap path (callback.js) is recorded elsewhere and is out of
 * scope here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture dispatcher invocations (the visit-recording seam).
const dispatchCalls = [];
vi.mock('../src/services/appointmentAutomations.js', () => ({
  dispatchAppointmentAutomation: vi.fn(async (_ctx, apt, eventType) => {
    dispatchCalls.push({ apt, eventType });
    return { notified: true, sideEffects: true, automationsFired: 0 };
  }),
}));
vi.mock('../src/telegram.js', () => ({ send: vi.fn(async () => ({ ok: true })) }));

import { phasePostVisit, POST_VISIT_HARD_CAP_SEC } from '../src/handlers/cron.js';

const NOW_MS = 1_750_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** ts (ms) for an appointment that ENDED `hoursAgo` hours before NOW,
 *  assuming a 60-min service (matches ctx.svc below). */
function tsEndedHoursAgo(hoursAgo) {
  const endSec = NOW_SEC - hoursAgo * 3600;
  return (endSec - 60 * 60) * 1000; // ts = end − duration
}

/**
 * Hand-rolled D1 mock. The candidate scan returns the seeded rows; the
 * auto-done UPDATE removes them from the pool (mirroring the real
 * `visit_confirmed_at IS NULL` filter) so a second cron tick re-selects
 * nothing — locking in the idempotency contract.
 */
function makeCtx({ rows = [] } = {}) {
  const calls = { run: [] };
  let pool = rows.slice();
  const ctx = {
    tenantId: 't1',
    svc: [{ id: 'svc_a', dur: 60 }],
    db: {
      prepare(sql) {
        let bound = [];
        return {
          bind(...a) { bound = a; return this; },
          async first() { return null; },
          async all() {
            if (/FROM appointments/i.test(sql)) return { results: pool.slice() };
            return { results: [] };
          },
          async run() {
            calls.run.push({ sql, args: bound });
            if (/UPDATE appointments[\s\S]*status\s*=\s*'done'/i.test(sql)) {
              // Auto-done UPDATE: drop the affected ids from the candidate
              // pool, exactly as `visit_confirmed_at IS NULL` would.
              const ids = bound.slice(2); // [nowSec, tenantId, ...ids]
              pool = pool.filter((r) => !ids.includes(r.id));
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
  return { ctx, calls };
}

beforeEach(() => {
  dispatchCalls.length = 0;
  vi.clearAllMocks();
});

describe('C6 — auto-done records the visit via the dispatcher', () => {
  it('calls dispatchAppointmentAutomation("appointment.done") for an auto-doned apt', async () => {
    const { ctx } = makeCtx({
      rows: [{
        id: 'a1', ts: tsEndedHoursAgo(25), date: '2026-05-15', time: '12:00',
        svc_id: 'svc_a', chat_id: 555, master_id: 100, master_is_synthetic: 0,
        review_requested_at: NOW_SEC - 22 * 3600, // Stage-1 delivered → eligible
      }],
    });
    await phasePostVisit(ctx, NOW_MS);

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0].eventType).toBe('appointment.done');
    // The dispatcher reads camelCase (apt.id / apt.chatId) — verify the
    // doc-shaped apt was passed, not the raw snake_case row.
    expect(dispatchCalls[0].apt.id).toBe('a1');
    expect(dispatchCalls[0].apt.chatId).toBe(555);
  });

  it('does NOT record a visit for an apt that is not yet eligible for auto-done', async () => {
    const { ctx } = makeCtx({
      rows: [{
        id: 'a2', ts: tsEndedHoursAgo(23), date: '2026-05-15', time: '12:00',
        svc_id: 'svc_a', chat_id: 555, master_id: 100, master_is_synthetic: 0,
        review_requested_at: NOW_SEC - 20 * 3600, // ended <24h ago → defer
      }],
    });
    await phasePostVisit(ctx, NOW_MS);
    expect(dispatchCalls).toHaveLength(0);
  });

  it('is idempotent — two cron ticks record the visit exactly once', async () => {
    const { ctx } = makeCtx({
      rows: [{
        id: 'a3', ts: tsEndedHoursAgo(25), date: '2026-05-15', time: '12:00',
        svc_id: 'svc_a', chat_id: 555, master_id: 100, master_is_synthetic: 0,
        review_requested_at: NOW_SEC - 22 * 3600,
      }],
    });
    await phasePostVisit(ctx, NOW_MS);
    await phasePostVisit(ctx, NOW_MS);
    expect(dispatchCalls).toHaveLength(1);
  });

  it('records each of several auto-doned apts exactly once', async () => {
    const mk = (id, chat) => ({
      id, ts: tsEndedHoursAgo(25), date: '2026-05-15', time: '12:00',
      svc_id: 'svc_a', chat_id: chat, master_id: 100, master_is_synthetic: 0,
      review_requested_at: NOW_SEC - 22 * 3600,
    });
    const { ctx } = makeCtx({ rows: [mk('a1', 1), mk('a2', 2), mk('a3', 3)] });
    await phasePostVisit(ctx, NOW_MS);
    expect(dispatchCalls).toHaveLength(3);
    expect(dispatchCalls.every((c) => c.eventType === 'appointment.done')).toBe(true);
    expect(dispatchCalls.map((c) => c.apt.chatId).sort()).toEqual([1, 2, 3]);
  });
});
