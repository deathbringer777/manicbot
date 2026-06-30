/**
 * C3 — returning-client win-back promo: epoch-units regression.
 *
 * `appointments.ts` is epoch MILLISECONDS (migration 0101). The
 * returning-candidate scan in processBirthdayAndReturningPromos (driven via
 * the exported `phasePromos` wrapper) bounds `ts BETWEEN <lo> AND <hi>` for
 * the "last visit 60–90 days ago" window. The pre-fix code bound the two
 * bounds in SECONDS (nowSec − N·86400), so against ms-scale `ts` the window
 * never matched and the win-back promo was effectively dead.
 *
 * This test locks the fix: the two BETWEEN bounds MUST be bound in
 * milliseconds (nowMs − N·86400·1000), so a status='done' row at ts = now−75d
 * IS selected as a returning candidate and ts = now−120d is NOT. Because the
 * D1 mock cannot evaluate BETWEEN itself, we model the window in JS using the
 * exact bound args the cron passes — which is precisely what we want to pin.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/telegram.js', () => ({ send: vi.fn(async () => ({ ok: true })) }));

import { phasePromos } from '../src/handlers/cron.js';

const DAY_MS = 86400 * 1000;
const NOW_MS = 1_750_000_000_000;

/** ms timestamp for a visit `days` days before NOW. */
function tsDaysAgo(days) {
  return NOW_MS - days * DAY_MS;
}

/**
 * Hand-rolled D1 mock. The returning scan is:
 *   SELECT DISTINCT chat_id FROM appointments
 *   WHERE tenant_id = ? AND status = 'done' AND ts BETWEEN ? AND ?
 * The two BETWEEN bounds are bound args [1] (lo) and [2] (hi). We evaluate the
 * window in JS against those exact bounds, so the test fails if the cron binds
 * seconds instead of milliseconds (the C3 bug).
 */
function makeCtx({ appts = [] } = {}) {
  const captured = { returningScans: [] };
  const ctx = {
    tenantId: 't1',
    db: {
      prepare(sql) {
        let bound = [];
        return {
          bind(...a) { bound = a; return this; },
          async first() { return null; },
          async all() {
            if (/FROM appointments[\s\S]*status\s*=\s*'done'[\s\S]*ts BETWEEN/i.test(sql)) {
              const lo = bound[1];
              const hi = bound[2];
              captured.returningScans.push({ lo, hi });
              const matched = appts.filter(
                (a) => a.status === 'done' && a.ts >= lo && a.ts <= hi,
              );
              // SELECT DISTINCT chat_id
              const seen = new Set();
              const out = [];
              for (const a of matched) {
                if (seen.has(a.chat_id)) continue;
                seen.add(a.chat_id);
                out.push({ chat_id: a.chat_id });
              }
              return { results: out };
            }
            // Birthday users scan — none.
            return { results: [] };
          },
          async run() { return { meta: { changes: 0 } }; },
        };
      },
    },
  };
  return { ctx, captured };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('C3 — returning-promo BETWEEN bounds are milliseconds', () => {
  it('binds the 60d/90d window in milliseconds (nowMs − N·86400·1000)', async () => {
    const { ctx, captured } = makeCtx({ appts: [] });
    await phasePromos(ctx, NOW_MS);
    expect(captured.returningScans).toHaveLength(1);
    const { lo, hi } = captured.returningScans[0];
    // lo = now − 90 days (ms), hi = now − 60 days (ms).
    expect(lo).toBe(NOW_MS - 90 * DAY_MS);
    expect(hi).toBe(NOW_MS - 60 * DAY_MS);
  });

  it('selects a done visit at ts = now−75d as a returning candidate', async () => {
    const captured = [];
    const { ctx } = makeCtx({
      appts: [{ chat_id: 555, status: 'done', ts: tsDaysAgo(75) }],
    });
    // Spy on the analytics INSERT so we can assert the candidate was emitted.
    const seen = [];
    const origPrepare = ctx.db.prepare;
    ctx.db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      const origRun = stmt.run.bind(stmt);
      let bound = [];
      const wrapped = {
        bind(...a) { bound = a; stmt.bind(...a); return wrapped; },
        first: stmt.first.bind(stmt),
        all: stmt.all.bind(stmt),
        async run() {
          if (/promo\.returning_candidate/i.test(sql)) seen.push({ sql, bound });
          return origRun();
        },
      };
      return wrapped;
    };
    await phasePromos(ctx, NOW_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0].bound).toContain('555');
  });

  it('does NOT select a done visit at ts = now−120d (outside the 90d floor)', async () => {
    const { ctx } = makeCtx({
      appts: [{ chat_id: 777, status: 'done', ts: tsDaysAgo(120) }],
    });
    const seen = [];
    const origPrepare = ctx.db.prepare;
    ctx.db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      const origRun = stmt.run.bind(stmt);
      const wrapped = {
        bind(...a) { stmt.bind(...a); return wrapped; },
        first: stmt.first.bind(stmt),
        all: stmt.all.bind(stmt),
        async run() {
          if (/promo\.returning_candidate/i.test(sql)) seen.push(sql);
          return origRun();
        },
      };
      return wrapped;
    };
    await phasePromos(ctx, NOW_MS);
    expect(seen).toHaveLength(0);
  });
});
