/**
 * Post-visit follow-up phase (24h after a visit).
 *
 * The marketing «После визита» template should fire ~24h after a client's
 * visit, on both channels:
 *   - email/SMS via the existing marketing pipeline (fireAutomationForEvent)
 *   - Telegram review ask (opt-in), reusing the existing rev: ⭐ keyboard
 *
 * Design mirrors processPostVisitConfirmations: a coarse SQL pre-filter +
 * a pure JS decision helper (isPostVisitFollowupDue) for the time window,
 * and a claim-by-conditional-UPDATE on `followup_24h_sent_at` so overlapping
 * cron ticks / queue redeliveries can never double-send.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tgSent = [];
vi.mock('../src/telegram.js', () => ({
  send: vi.fn(async (_ctx, chatId, text, opts) => {
    tgSent.push({ chatId, text, opts });
    return { ok: true };
  }),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'),
}));
const fireCalls = [];
vi.mock('../src/services/marketing/automations.js', () => ({
  fireAutomationForEvent: vi.fn(async (_ctx, eventType, opts) => {
    fireCalls.push({ eventType, opts });
    return { fired: 1, skipped: 0, errors: 0, automations: 1 };
  }),
}));
vi.mock('../src/utils/helpers.js', async (orig) => {
  const mod = await orig();
  return { ...mod, t: (_lg, key) => `T:${key}` };
});

import {
  phasePostVisitFollowup,
  isPostVisitFollowupDue,
  POST_VISIT_FOLLOWUP_DELAY_SEC,
  POST_VISIT_FOLLOWUP_LOOKBACK_SEC,
} from '../src/handlers/cron.js';

const NOW_MS = 1_750_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** ts (ms) for an appointment whose visit ends `hoursAgo` hours before NOW,
 *  assuming a 60-min service (matches ctx.svc below). */
function tsEndingHoursAgo(hoursAgo) {
  const endSec = NOW_SEC - hoursAgo * 3600;
  return (endSec - 60 * 60) * 1000; // ts = end - duration
}

/**
 * Hand-rolled D1 mock. Routes by SQL regex and models the
 * `followup_24h_sent_at IS NULL` state via a `claimed` set so a second pass
 * (or second matching row) reports zero changes — exactly the real claim
 * semantics.
 */
function makeCtx({ rows = [], tgEnabled = false, hasAuto = false } = {}) {
  const calls = { all: [], run: [], get: [] };
  const claimed = new Set();
  const ctx = {
    tenantId: 't1',
    svc: [{ id: 'svc_a', dur: 60 }],
    db: {
      prepare(sql) {
        let bound = [];
        return {
          bind(...a) { bound = a; return this; },
          async first() {
            calls.get.push({ sql, args: bound });
            if (/FROM tenant_config/i.test(sql)) {
              return bound[1] === 'post_visit_followup_tg_enabled' && tgEnabled
                ? { value: 'true' } : null;
            }
            if (/FROM marketing_automations/i.test(sql)) {
              return hasAuto ? { x: 1 } : null;
            }
            return null;
          },
          async all() {
            calls.all.push({ sql, args: bound });
            if (/FROM appointments/i.test(sql)) {
              return { results: rows.filter((r) => !claimed.has(r.id)) };
            }
            return { results: [] };
          },
          async run() {
            calls.run.push({ sql, args: bound });
            if (/UPDATE appointments SET followup_24h_sent_at/i.test(sql)) {
              const id = bound[1]; // SET ?=now, WHERE id = ?, tenant_id = ?
              if (claimed.has(id)) return { meta: { changes: 0 } };
              claimed.add(id);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    },
  };
  return { ctx, calls, claimed };
}

beforeEach(() => {
  tgSent.length = 0;
  fireCalls.length = 0;
  vi.clearAllMocks();
});

describe('isPostVisitFollowupDue — time window', () => {
  it('exports a 24h delay and a 48h look-back', () => {
    expect(POST_VISIT_FOLLOWUP_DELAY_SEC).toBe(24 * 3600);
    expect(POST_VISIT_FOLLOWUP_LOOKBACK_SEC).toBe(48 * 3600);
  });

  it('is due once the visit ended ≥24h ago (within look-back)', () => {
    const endSec = NOW_SEC - 25 * 3600;
    expect(isPostVisitFollowupDue(endSec, NOW_SEC)).toBe(true);
  });

  it('is NOT due when the visit ended <24h ago', () => {
    const endSec = NOW_SEC - 23 * 3600;
    expect(isPostVisitFollowupDue(endSec, NOW_SEC)).toBe(false);
  });

  it('is NOT due for a visit still in the future', () => {
    const endSec = NOW_SEC + 3600;
    expect(isPostVisitFollowupDue(endSec, NOW_SEC)).toBe(false);
  });

  it('is NOT due beyond the 24h+look-back floor (avoids first-deploy backfill)', () => {
    const endSec = NOW_SEC - (24 + 48 + 1) * 3600;
    expect(isPostVisitFollowupDue(endSec, NOW_SEC)).toBe(false);
  });
});

describe('phasePostVisitFollowup — orchestration', () => {
  it('early-outs (no scan) when Telegram is off AND no post_visit_24h automation exists', async () => {
    const { ctx, calls } = makeCtx({ rows: [{ id: 'a1', ts: tsEndingHoursAgo(25), duration: null, svc_id: 'svc_a', chat_id: 555 }], tgEnabled: false, hasAuto: false });
    await phasePostVisitFollowup(ctx, NOW_MS);
    expect(calls.all.some((c) => /FROM appointments/i.test(c.sql))).toBe(false);
    expect(fireCalls).toHaveLength(0);
    expect(tgSent).toHaveLength(0);
  });

  it('fires the email automation (post_visit_24h) for a due visit and claims it', async () => {
    const { ctx, calls } = makeCtx({ rows: [{ id: 'a1', ts: tsEndingHoursAgo(25), duration: null, svc_id: 'svc_a', chat_id: 555 }], tgEnabled: false, hasAuto: true });
    await phasePostVisitFollowup(ctx, NOW_MS);
    expect(fireCalls).toHaveLength(1);
    expect(fireCalls[0].eventType).toBe('post_visit_24h');
    expect(fireCalls[0].opts).toEqual({ chatId: 555 });
    // claim UPDATE issued
    expect(calls.run.some((c) => /UPDATE appointments SET followup_24h_sent_at/i.test(c.sql))).toBe(true);
    // Telegram off → no bot message
    expect(tgSent).toHaveLength(0);
  });

  it('sends the Telegram ⭐ review ask when the opt-in flag is on (and still fires email)', async () => {
    const { ctx } = makeCtx({ rows: [{ id: 'a1', ts: tsEndingHoursAgo(25), duration: null, svc_id: 'svc_a', chat_id: 555 }], tgEnabled: true, hasAuto: true });
    await phasePostVisitFollowup(ctx, NOW_MS);
    expect(fireCalls).toHaveLength(1);
    expect(tgSent).toHaveLength(1);
    expect(tgSent[0].chatId).toBe(555);
    expect(tgSent[0].text).toMatch(/review_request/);
    const kb = tgSent[0].opts?.reply_markup?.inline_keyboard;
    expect(Array.isArray(kb)).toBe(true);
    expect(kb[0][0].callback_data).toMatch(/^rev:a1:/);
  });

  it('skips a visit that ended <24h ago — no claim, no fire, no send', async () => {
    const { ctx, calls } = makeCtx({ rows: [{ id: 'a1', ts: tsEndingHoursAgo(2), duration: null, svc_id: 'svc_a', chat_id: 555 }], tgEnabled: true, hasAuto: true });
    await phasePostVisitFollowup(ctx, NOW_MS);
    expect(fireCalls).toHaveLength(0);
    expect(tgSent).toHaveLength(0);
    expect(calls.run.some((c) => /UPDATE appointments SET followup_24h_sent_at/i.test(c.sql))).toBe(false);
  });

  it('is idempotent — running twice fires exactly once (claim guards re-send)', async () => {
    const { ctx } = makeCtx({ rows: [{ id: 'a1', ts: tsEndingHoursAgo(25), duration: null, svc_id: 'svc_a', chat_id: 555 }], tgEnabled: true, hasAuto: true });
    await phasePostVisitFollowup(ctx, NOW_MS);
    await phasePostVisitFollowup(ctx, NOW_MS);
    expect(fireCalls).toHaveLength(1);
    expect(tgSent).toHaveLength(1);
  });

  it('scans tenant-scoped with the eligibility predicate (done, not cancelled, not no-show, unsent)', async () => {
    const { ctx, calls } = makeCtx({ rows: [], tgEnabled: false, hasAuto: true });
    await phasePostVisitFollowup(ctx, NOW_MS);
    const scan = calls.all.find((c) => /FROM appointments/i.test(c.sql));
    expect(scan).toBeTruthy();
    expect(scan.sql).toMatch(/tenant_id\s*=\s*\?/i);
    expect(scan.sql).toMatch(/cancelled\s*=\s*0/i);
    expect(scan.sql).toMatch(/no_show\s*=\s*0/i);
    expect(scan.sql).toMatch(/followup_24h_sent_at\s+IS\s+NULL/i);
    expect(scan.args).toContain('t1');
  });
});
