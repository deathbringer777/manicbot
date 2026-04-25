/**
 * @fileoverview D1-backed rate limiter (replaces in-memory per-isolate Maps).
 *
 * Uses the `rate_limits` table from migration 0027:
 *   PRIMARY KEY (key, action), count INTEGER, window_start INTEGER
 *
 * Sliding-window approximation: each row represents one (key, action) pair
 * with the current window's count and start timestamp. When `windowStart` is
 * older than `windowSec` ago, the count resets to 1.
 *
 * #S10: wired to admin Basic Auth so failed credential attempts are throttled
 * per-credential (NOT per-IP — admin-app's egress through Cloudflare can share
 * IPs with attackers, and rate-limiting per-IP would let admin-app DoS itself).
 */

import { dbGet, dbRun } from './db.js';
import { nowSec } from './time.js';

/**
 * Atomically check + increment a rate-limit counter.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} key      - identity dimension (e.g. credential hash, tenant id)
 * @param {string} action   - what's being limited (e.g. 'admin-auth-fail')
 * @param {number} limit    - max events allowed in window
 * @param {number} windowSec - window duration in seconds
 * @returns {Promise<{ count: number, limited: boolean, retryAfter: number }>}
 */
export async function checkAndIncrement(ctx, key, action, limit, windowSec) {
  if (!ctx?.db) return { count: 0, limited: false, retryAfter: 0 };
  const now = nowSec();
  const row = await dbGet(ctx,
    'SELECT count, window_start FROM rate_limits WHERE key = ? AND action = ?',
    key, action,
  );
  let count = 1;
  let windowStart = now;
  if (row && (now - row.window_start) < windowSec) {
    count = row.count + 1;
    windowStart = row.window_start;
  }
  await dbRun(ctx,
    `INSERT INTO rate_limits (key, action, count, window_start)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key, action) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`,
    key, action, count, windowStart,
  );
  const limited = count > limit;
  const retryAfter = limited ? Math.max(0, windowSec - (now - windowStart)) : 0;
  return { count, limited, retryAfter };
}

/**
 * Read-only check: returns current state without incrementing the counter.
 * Use for pre-flight checks before performing the auth comparison.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} key
 * @param {string} action
 * @param {number} limit
 * @param {number} windowSec
 * @returns {Promise<{ count: number, limited: boolean, retryAfter: number }>}
 */
export async function checkCount(ctx, key, action, limit, windowSec) {
  if (!ctx?.db) return { count: 0, limited: false, retryAfter: 0 };
  const now = nowSec();
  const row = await dbGet(ctx,
    'SELECT count, window_start FROM rate_limits WHERE key = ? AND action = ?',
    key, action,
  );
  if (!row || (now - row.window_start) >= windowSec) {
    return { count: 0, limited: false, retryAfter: 0 };
  }
  const limited = row.count >= limit;
  const retryAfter = limited ? Math.max(0, windowSec - (now - row.window_start)) : 0;
  return { count: row.count, limited, retryAfter };
}

/**
 * Best-effort cleanup of expired rate-limit rows. Call from cron.
 *
 * @param {{ db: D1Database }} ctx
 * @param {number} olderThanSec
 */
export async function cleanupExpired(ctx, olderThanSec = 86400) {
  if (!ctx?.db) return 0;
  const cutoff = nowSec() - olderThanSec;
  const result = await dbRun(ctx, 'DELETE FROM rate_limits WHERE window_start < ?', cutoff);
  return result?.meta?.changes ?? 0;
}

/**
 * Hash a credential into a short fingerprint for use as a rate-limit key.
 * SHA-256 truncated to 16 hex chars (8 bytes / 64 bits) — enough entropy to
 * disambiguate honest typos from brute-force without storing the credential.
 */
export async function credentialFingerprint(credential) {
  const enc = new TextEncoder().encode(String(credential || ''));
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(digest)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}
