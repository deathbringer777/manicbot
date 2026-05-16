/**
 * Structural regression test for manicbot/wrangler.toml.
 *
 * Background — the 2026-05-16 prod check found that Workers Observability
 * was off on the manicbot worker. Every Cloudflare-dashboard query for
 * errors/requests/latencies returned zero events because the head-sampling
 * pipeline wasn't wired. We had the in-house captureError() → D1
 * error_events pane, but a Worker crash that happens before captureError
 * has a chance to write would be invisible. Enabling [observability]
 * gives us a second pane of glass via `wrangler tail` and the dashboard.
 *
 * This test pins the invariant so the next person who "cleans up"
 * wrangler.toml and drops the [observability] block gets a loud failure
 * before merge instead of a silent prod-visibility regression.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WRANGLER_PATH = join(process.cwd(), 'wrangler.toml');

describe('wrangler.toml — observability invariants', () => {
  const src = readFileSync(WRANGLER_PATH, 'utf8');

  it('declares an [observability] block', () => {
    expect(src).toMatch(/^\[observability\]\s*$/m);
  });

  it('has enabled = true in the [observability] block', () => {
    // Match the block and assert `enabled = true` appears inside it (before
    // any next top-level [section] header).
    const block = src.match(/^\[observability\][^\[]*/m)?.[0] ?? '';
    expect(block).toMatch(/^\s*enabled\s*=\s*true\s*$/m);
  });

  it('declares a head_sampling_rate between 0 and 1', () => {
    const block = src.match(/^\[observability\][^\[]*/m)?.[0] ?? '';
    const m = block.match(/^\s*head_sampling_rate\s*=\s*([0-9.]+)\s*$/m);
    expect(m).not.toBeNull();
    const rate = Number(m[1]);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(1);
  });
});
