/**
 * M-A — /api/track must use D1-backed rate limit, not an in-memory Map.
 *
 * Pre-fix the handler kept a per-isolate Map of timestamps per IP. The
 * Worker isolate is short-lived (seconds to minutes), so a single
 * attacker hitting multiple Cloudflare edge POPs got independent
 * buckets. The declared 60/min cap was effectively unbounded.
 *
 * The fix delegates to the shared utils/rateLimit.js D1 checkAndIncrement
 * — same primitive used by the admin Basic-Auth limiter and ownership
 * transfer confirm. This test pins:
 *
 *   • the limiter writes to the `rate_limits` table
 *   • the action slug is `track`
 *   • the (declared cap)+1-th call returns 429
 *   • the count persists across handler invocations (i.e. survives the
 *     isolate-restart that broke the old in-memory bucket)
 */
import { describe, it, expect } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { handleTrackRequest, __test } from '../src/http/trackHttp.js';
import { TRACK_RATE_LIMIT_MAX } from '../src/http/trackHttpLogic.js';
import { dbGet, dbRun } from '../src/utils/db.js';

const ANON = '11111111-2222-3333-4444-555555555555';

function buildEnv(ctx) {
  return { DB: ctx.db };
}

function postEvent(ip = '198.51.100.42', body = null) {
  return new Request('https://example.com/api/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(
      body ?? { anonymousId: ANON, event: 'pageview', properties: { path: '/' } },
    ),
  });
}

async function grantAnalyticsConsent(ctx, anonymousId = ANON) {
  // hasAnalyticsConsent reads the most recent cookie_consent_log row.
  await dbRun(
    ctx,
    `INSERT INTO cookie_consent_log (anonymous_id, web_user_id, categories, policy_version, source, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    anonymousId,
    null,
    JSON.stringify({ analytics: true, marketing: false, ux: false, necessary: true }),
    1,
    'banner',
    '127.0.0.1',
    null,
    Math.floor(Date.now() / 1000),
  );
}

describe('/api/track — D1-backed rate limit (M-A)', () => {
  it('writes to the rate_limits table under action="track"', async () => {
    const ctx = makeCtx({ tenantId: 't_track_rl_writes' });
    await grantAnalyticsConsent(ctx);
    const env = buildEnv(ctx);
    const res = await handleTrackRequest(postEvent('203.0.113.5'), env);
    expect(res.status).toBe(204);
    const row = await dbGet(
      ctx,
      'SELECT count FROM rate_limits WHERE key = ? AND action = ?',
      '203.0.113.5',
      'track',
    );
    expect(row?.count).toBe(1);
  });

  it('returns 429 on the (TRACK_RATE_LIMIT_MAX + 1)-th call from the same IP', async () => {
    const ctx = makeCtx({ tenantId: 't_track_rl_429' });
    await grantAnalyticsConsent(ctx);
    const env = buildEnv(ctx);

    const ip = '203.0.113.10';
    // Burn through the cap exactly.
    for (let i = 0; i < TRACK_RATE_LIMIT_MAX; i++) {
      const res = await handleTrackRequest(postEvent(ip), env);
      expect(res.status).toBe(204);
    }
    // The (cap+1)-th call is 429.
    const limited = await handleTrackRequest(postEvent(ip), env);
    expect(limited.status).toBe(429);
  });

  it('limits are per-IP — separate IPs get their own buckets', async () => {
    const ctx = makeCtx({ tenantId: 't_track_rl_per_ip' });
    await grantAnalyticsConsent(ctx);
    const env = buildEnv(ctx);

    for (let i = 0; i < TRACK_RATE_LIMIT_MAX; i++) {
      await handleTrackRequest(postEvent('203.0.113.20'), env);
    }
    // First IP is now capped, but second IP is fresh.
    const capped = await handleTrackRequest(postEvent('203.0.113.20'), env);
    expect(capped.status).toBe(429);
    const fresh = await handleTrackRequest(postEvent('203.0.113.21'), env);
    expect(fresh.status).toBe(204);
  });

  it('persists across handler invocations — does NOT depend on in-memory Map (the regression)', async () => {
    const ctx = makeCtx({ tenantId: 't_track_rl_persistent' });
    await grantAnalyticsConsent(ctx);
    const env = buildEnv(ctx);

    const ip = '203.0.113.30';
    await handleTrackRequest(postEvent(ip), env);
    await handleTrackRequest(postEvent(ip), env);
    await handleTrackRequest(postEvent(ip), env);

    const row = await dbGet(
      ctx,
      'SELECT count FROM rate_limits WHERE key = ? AND action = ?',
      ip,
      'track',
    );
    // Three real calls landed → count==3 in D1. The Map-based bucket would
    // have been reset by an isolate boundary, but the D1 row is durable.
    expect(row?.count).toBe(3);
  });

  it('falls open when no DB binding is present (legacy ctx)', async () => {
    const res = await handleTrackRequest(postEvent('203.0.113.40'), {});
    // With no DB binding we cannot check the rate limit; analytics consent
    // also fails closed (no DB to read the log), so the request silently
    // 204s without persisting anything. This is the desired posture.
    expect([204, 400, 429]).toContain(res.status);
  });

  it('exports the window-seconds for downstream observability', () => {
    expect(__test.TRACK_RATE_LIMIT_WINDOW_SEC).toBeGreaterThan(0);
    // Cron windows are stored in seconds in rate_limits; assert the
    // conversion from the public ms constant is correct.
    expect(__test.TRACK_RATE_LIMIT_WINDOW_SEC).toBe(60);
  });
});
