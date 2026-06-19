/**
 * phaseReminders — at-least-once reminder delivery (set the rem flag only
 * AFTER a successful send).
 *
 * Bug being pinned: the appointment-reminder cron used to claim the idempotency
 * flag (rem_h24 / rem_h2) BEFORE the channel send. Every send is wrapped in a
 * try/catch that only logs, and the Telegram fallback send can throw or return
 * { ok: false }. So a single transient send failure marked the appointment as
 * reminded and dropped the reminder permanently — the paying client never got
 * it, and no later tick retried.
 *
 * Desired behaviour (at-least-once): the flag is written only when at least one
 * channel send actually succeeds. A failed send leaves the flag UNSET so the
 * next 15-min tick (the reminder window is wider than one tick) retries. A
 * successful send sets the flag exactly once — a second tick is a no-op.
 *
 * Harness mirrors cron-post-visit-followup.test.js: mock telegram.send +
 * chat.getLang, hand-roll a tenant-scoped D1 mock that applies the UPDATE to
 * the in-memory row so flag state is observable across ticks. No
 * channel_identities rows are returned, so delivery always falls through to the
 * Telegram fallback — the send path under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Controllable Telegram send. `tgBehavior` decides per-call outcome so a test
// can simulate a transient failure (throw or { ok:false }) then a recovery.
const tgSent = [];
let tgBehavior = () => ({ ok: true });
vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async (_ctx, chatId, text, opts) => {
    tgSent.push({ chatId, text, opts });
    return tgBehavior(chatId, text);
  }),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'),
}));

import { phaseReminders } from '../src/handlers/cron.js';

const NOW_MS = 1_750_000_000_000;
const HOUR_MS = 3_600_000;

/** ts (ms) for an appointment `hoursAhead` hours in the future from NOW. */
const tsHoursAhead = (hoursAhead) => NOW_MS + hoursAhead * HOUR_MS;

/** w-struct (warsawNow shape) — phaseReminders only reads year/month/day to
 *  build the date IN (?, ?) filter; our mock ignores it and returns rows
 *  directly, so the exact date does not matter. */
const W = { year: 2025, month: 6, day: 15 };

/**
 * Tenant-scoped D1 mock. The appointments SELECT returns the seeded rows; the
 * channel_identities SELECT returns nothing (force the Telegram fallback). The
 * rem_h24 / rem_h2 UPDATE is applied to the live row object so a second tick
 * sees the persisted flag — exactly the real idempotency mechanism.
 */
function makeCtx({ rows = [] } = {}) {
  const calls = { all: [], run: [], get: [] };
  const ctx = {
    tenantId: 't1',
    tenant: { salon: { name: 'Test Salon', address: 'Addr 1', mapsUrl: 'https://maps' } },
    svc: [{ id: 'classic', dur: 60, names: { ru: 'Маникюр' } }],
    db: {
      prepare(sql) {
        let bound = [];
        return {
          bind(...a) { bound = a; return this; },
          async first() { calls.get.push({ sql, args: bound }); return null; },
          async all() {
            calls.all.push({ sql, args: bound });
            if (/FROM appointments/i.test(sql)) return { results: rows };
            // channel_identities and everything else: empty → TG fallback.
            return { results: [] };
          },
          async run() {
            calls.run.push({ sql, args: bound });
            const m = sql.match(/UPDATE appointments SET (.+?) WHERE id = \? AND tenant_id = \?/i);
            if (m) {
              const setCols = m[1].split(',').map(s => s.trim());
              // bound = [...setVals, id, tenantId]
              const id = bound[bound.length - 2];
              const row = rows.find(r => r.id === id);
              if (row) setCols.forEach((sc, i) => { row[sc.split('=')[0].trim()] = bound[i]; });
              return { meta: { changes: row ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    },
  };
  return { ctx, calls };
}

/** Count UPDATEs that set rem_h24 / rem_h2 (the idempotency claim). */
const remClaimRuns = (calls) =>
  calls.run.filter(c => /UPDATE appointments SET .*rem_h(24|2)/i.test(c.sql));

beforeEach(() => {
  tgSent.length = 0;
  tgBehavior = () => ({ ok: true });
  vi.clearAllMocks();
});

describe('phaseReminders — set rem flag only after a successful send (24h)', () => {
  it('a send that THROWS leaves rem_h24 UNSET so the next tick retries', async () => {
    const row = { id: 'a1', ts: tsHoursAhead(24), rem_h24: 0, rem_h2: 0, chat_id: 555, svc_id: 'classic', date: '2025-06-16', time: '12:00' };
    const { ctx, calls } = makeCtx({ rows: [row] });
    tgBehavior = () => { throw new Error('transient TG network error'); };

    await phaseReminders(ctx, NOW_MS, W);

    // The send was attempted…
    expect(tgSent.length).toBeGreaterThanOrEqual(1);
    // …but the flag must NOT be claimed on failure.
    expect(row.rem_h24).toBeFalsy();
    expect(remClaimRuns(calls)).toHaveLength(0);
  });

  it('a send that returns { ok:false } also leaves rem_h24 UNSET', async () => {
    const row = { id: 'a1', ts: tsHoursAhead(24), rem_h24: 0, rem_h2: 0, chat_id: 555, svc_id: 'classic', date: '2025-06-16', time: '12:00' };
    const { ctx } = makeCtx({ rows: [row] });
    tgBehavior = () => ({ ok: false, description: 'rate limited' });

    await phaseReminders(ctx, NOW_MS, W);

    expect(tgSent.length).toBeGreaterThanOrEqual(1);
    expect(row.rem_h24).toBeFalsy();
  });

  it('the next tick after a failure retries and, on success, sends + claims once', async () => {
    const row = { id: 'a1', ts: tsHoursAhead(24), rem_h24: 0, rem_h2: 0, chat_id: 555, svc_id: 'classic', date: '2025-06-16', time: '12:00' };
    const { ctx } = makeCtx({ rows: [row] });

    // Tick 1: transient failure → no claim.
    tgBehavior = () => { throw new Error('boom'); };
    await phaseReminders(ctx, NOW_MS, W);
    expect(row.rem_h24).toBeFalsy();
    const afterFail = tgSent.length;

    // Tick 2: recovered → send goes through and the flag is set.
    tgBehavior = () => ({ ok: true });
    await phaseReminders(ctx, NOW_MS, W);
    expect(tgSent.length).toBe(afterFail + 1); // retried exactly once
    expect(row.rem_h24).toBe(1);
  });
});

describe('phaseReminders — successful send sets the flag exactly once', () => {
  it('a successful 24h send sets rem_h24 and a second tick is a no-op (no duplicate)', async () => {
    const row = { id: 'a1', ts: tsHoursAhead(24), rem_h24: 0, rem_h2: 0, chat_id: 555, svc_id: 'classic', date: '2025-06-16', time: '12:00' };
    const { ctx, calls } = makeCtx({ rows: [row] });

    await phaseReminders(ctx, NOW_MS, W);
    expect(row.rem_h24).toBe(1);
    expect(tgSent).toHaveLength(1);
    expect(remClaimRuns(calls)).toHaveLength(1);

    // Second tick: flag already set → do24 is false → no send, no claim.
    await phaseReminders(ctx, NOW_MS, W);
    expect(tgSent).toHaveLength(1);
    expect(remClaimRuns(calls)).toHaveLength(1);
  });

  it('a successful 2h send sets rem_h2 exactly once', async () => {
    const row = { id: 'a2', ts: tsHoursAhead(2), rem_h24: 1, rem_h2: 0, chat_id: 777, svc_id: 'classic', date: '2025-06-15', time: '14:00' };
    const { ctx } = makeCtx({ rows: [row] });

    await phaseReminders(ctx, NOW_MS, W);
    expect(row.rem_h2).toBe(1);
    expect(tgSent).toHaveLength(1);

    await phaseReminders(ctx, NOW_MS, W);
    expect(tgSent).toHaveLength(1); // no duplicate 2h reminder
  });
});
