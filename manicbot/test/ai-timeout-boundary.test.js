/**
 * P1-14 — AI per-model timeout cap.
 *
 * Before: 8000 ms × 3 models × Promise.race with a redundant second binding
 * retry on AI_MODEL → 24-32 s worst-case latency.
 *
 * After: 4000 ms × 3 models × single binding race → 12 s worst case.
 *
 * This test asserts the constant value and the runtime ceiling.
 */
import { describe, it, expect } from 'vitest';
import { AI_TIMEOUT_MS, runWorkersAI } from '../src/ai.js';

describe('AI timeout boundary (P1-14)', () => {
  it('AI_TIMEOUT_MS is capped at 4000 ms', () => {
    expect(AI_TIMEOUT_MS).toBe(4000);
    expect(AI_TIMEOUT_MS).toBeLessThanOrEqual(4000);
  });

  it('runWorkersAI binding race aborts before 4500 ms per model', async () => {
    // Stub a permanently-hanging ctx.AI.run; expect runWorkersAI to bail out
    // for each model on its 4 s timeout. With 3 models, the total should be
    // < 13 s. We test 1 model worth of timing here to keep the test fast.
    const ctx = {
      WORKERS_AI_API_TOKEN: null,
      CLOUDFLARE_ACCOUNT_ID: null,
      AI: {
        run: () => new Promise(() => { /* never resolves */ }),
      },
    };
    const t0 = Date.now();
    const result = await runWorkersAI(ctx, 'hello world', 'en', 'client', []);
    const elapsed = Date.now() - t0;
    expect(result).toBeNull();
    // 3 models × 4 s ceil. Allow 1.5 s of overhead for the test runner.
    expect(elapsed).toBeLessThan(3 * AI_TIMEOUT_MS + 1500);
  }, 20000);

  it('no second binding retry is invoked on AI_MODEL after timeout', async () => {
    // P1-14 removed the second `{ instructions, input }` retry that doubled
    // the time budget for AI_MODEL. With 3 models and one race each, we
    // expect *exactly* 3 invocations of ctx.AI.run.
    let invocations = 0;
    const ctx = {
      WORKERS_AI_API_TOKEN: null,
      CLOUDFLARE_ACCOUNT_ID: null,
      AI: {
        run: async () => {
          invocations += 1;
          throw new Error('binding error');
        },
      },
    };
    await runWorkersAI(ctx, 'hello world', 'en', 'client', []);
    // 3 models = 3 invocations (no second-shape retry on AI_MODEL).
    expect(invocations).toBe(3);
  });
});
