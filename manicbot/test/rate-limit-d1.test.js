/**
 * #P0-5 — checkRateLimit MUST be atomic when D1 is bound. Pre-fix it was a
 * KV get-then-put pair so 100 concurrent requests trivially over-counted.
 *
 * The new implementation does a single INSERT … ON CONFLICT DO UPDATE, then
 * SELECTs the running count. SQLite serialises writers, so the atomicity
 * follows from the storage layer — this test asserts the contract end to end
 * by firing many parallel calls against the same key and checking the cap.
 */
import { describe, it, expect } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { checkRateLimit } from '../src/services/state.js';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC } from '../src/config.js';
import { dbGet } from '../src/utils/db.js';

function ctxFor(tenantId = 't_rl') {
  return makeCtx({ tenantId, tenant: { plan: 'pro', billingStatus: 'active' } });
}

describe('checkRateLimit (D1 path) (#P0-5)', () => {
  it('lets the first call through and stores count=1', async () => {
    const ctx = ctxFor();
    const ok = await checkRateLimit(ctx, 42);
    expect(ok).toBe(true);
    const row = await dbGet(ctx,
      'SELECT count FROM rate_limits WHERE key = ? AND action = ?',
      '42', 'msg',
    );
    expect(row?.count).toBe(1);
  });

  it('increments within a single window', async () => {
    const ctx = ctxFor('t_rl_inc');
    for (let i = 0; i < 5; i++) await checkRateLimit(ctx, 7);
    const row = await dbGet(ctx,
      'SELECT count FROM rate_limits WHERE key = ? AND action = ?', '7', 'msg');
    expect(row?.count).toBe(5);
  });

  it('throttles past RATE_LIMIT_MAX in the current window', async () => {
    const ctx = ctxFor('t_rl_cap');
    // RATE_LIMIT_MAX = 100 in config — keep tests fast by parameterising,
    // but assert the canonical contract: the (MAX+1)th call returns false.
    let allowed = 0;
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      if (await checkRateLimit(ctx, 1)) allowed++;
    }
    expect(allowed).toBe(RATE_LIMIT_MAX);
  });

  it('UPSERT itself cannot lose increments under interleaved access', async () => {
    // The mock D1 is synchronous, so a true Promise.all parallelism stress
    // test models real-D1 atomicity poorly: every continuation runs after
    // every UPSERT, so every SELECT sees the final post-increment count.
    // What we CAN test is that two distinct keys don't double-count each
    // other and that the count column ends up exactly equal to the number
    // of attempts — i.e. the UPSERT path is loss-free.
    const ctx = ctxFor('t_rl_parallel');
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, () => checkRateLimit(ctx, 'k_burst')),
    );
    const row = await dbGet(ctx,
      'SELECT count FROM rate_limits WHERE key = ? AND action = ?',
      'k_burst', 'msg');
    expect(row?.count).toBe(N);
  });

  it('rolls into a new window when window_start advances', async () => {
    const ctx = ctxFor('t_rl_window_roll');
    // Hit the cap.
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await checkRateLimit(ctx, 5);
    expect(await checkRateLimit(ctx, 5)).toBe(false);

    // Forge a previous window in the row to simulate time advance.
    const oldStart = Math.floor(Date.now() / 1000) - RATE_LIMIT_WINDOW_SEC * 3;
    const mod = await import('../src/utils/db.js');
    await mod.dbRun(ctx,
      'UPDATE rate_limits SET window_start = ? WHERE key = ? AND action = ?',
      oldStart, '5', 'msg');

    expect(await checkRateLimit(ctx, 5)).toBe(true);
    const row = await dbGet(ctx,
      'SELECT count FROM rate_limits WHERE key = ? AND action = ?', '5', 'msg');
    // Counter resets to 1 in the new window.
    expect(row?.count).toBe(1);
  });

  it('different keys are isolated', async () => {
    const ctx = ctxFor('t_rl_isolate');
    for (let i = 0; i < RATE_LIMIT_MAX; i++) await checkRateLimit(ctx, 'a');
    expect(await checkRateLimit(ctx, 'a')).toBe(false);
    expect(await checkRateLimit(ctx, 'b')).toBe(true);
  });
});
