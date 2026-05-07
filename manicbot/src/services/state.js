/**
 * User-state and per-user rate-limit primitives.
 *
 * Two stores back this module:
 *   - D1 `rate_limits` table (atomic UPSERT) — primary, used whenever ctx.db
 *     is available. SQLite serializes writes and the INSERT … ON CONFLICT is
 *     a single statement, so concurrent isolates can't bypass the cap.
 *   - KV `rl:{cid}` — legacy fallback, only when D1 is missing (preview /
 *     bare-Worker contexts). Best effort, not atomic; documented in #P0-5.
 *
 * Conversation state lives in KV with the user-controlled TTL. Each value
 * carries its own `expiresAt` so the read path can distinguish "user never
 * had state" from "user state lapsed mid-flow"; the latter triggers an
 * explicit i18n notice in the handlers (#P1-3) instead of a silent reset.
 */

import { STATE_TTL_SEC, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC } from '../config.js';
import { kvGet, kvPut, kvDel } from '../utils/kv.js';
import { dbGet, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

const STATE_KEY = (cid) => `st:${cid}`;
const RL_KV_KEY = (cid) => `rl:${cid}`;

/**
 * Atomically increment the per-user rate counter and return whether the
 * caller is still under the cap.
 *
 * D1 path: one INSERT … ON CONFLICT statement, so 100 concurrent calls
 * against the same key hit the SQLite write queue and produce a consistent
 * count. The follow-up SELECT may race with another increment but only by
 * +/-1 — well below the slack we'd accept.
 *
 * KV path: the legacy two-step (get + put) is preserved only when no D1 is
 * bound (preview tenants, very-early bootstrap). Cron cleans up the D1 table
 * once a day so it does not grow unbounded (handlers/cron.js Phase 5).
 *
 * @param {object} ctx
 * @param {string|number} cid
 * @param {string} [action='msg']
 * @returns {Promise<boolean>} false when the caller should be throttled.
 */
export async function checkRateLimit(ctx, cid, action = 'msg') {
  if (ctx?.db) {
    const key = String(cid);
    const now = nowSec();
    const windowStart = Math.floor(now / RATE_LIMIT_WINDOW_SEC) * RATE_LIMIT_WINDOW_SEC;
    try {
      // Single-statement atomic increment with window roll-over. SQLite
      // serializes writers, so this is consistent across concurrent isolates.
      await dbRun(ctx,
        `INSERT INTO rate_limits (key, action, count, window_start)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(key, action) DO UPDATE SET
           count        = CASE WHEN window_start = excluded.window_start
                               THEN count + 1
                               ELSE 1 END,
           window_start = excluded.window_start`,
        key, action, windowStart,
      );
      const row = await dbGet(ctx,
        'SELECT count FROM rate_limits WHERE key = ? AND action = ?',
        key, action,
      );
      return (row?.count ?? 0) <= RATE_LIMIT_MAX;
    } catch (e) {
      // If the rate-limit storage breaks we'd rather over-deliver than
      // hard-block real users. Log loudly and let the request through; the
      // KV path picks up if ctx.kv is still alive.
      log.error('services.state', e instanceof Error ? e : new Error(String(e?.message)),
        { phase: 'rate_limit_d1', cid: key });
    }
  }

  // KV fallback (best-effort, used only when D1 unavailable).
  if (!ctx?.kv) return true;
  try {
    const k = RL_KV_KEY(cid);
    const count = await kvGet(ctx, k);
    if (count !== null && count >= RATE_LIMIT_MAX) return false;
    await kvPut(ctx, k, (count || 0) + 1, { expirationTtl: RATE_LIMIT_WINDOW_SEC });
    return true;
  } catch {
    return true;
  }
}

/**
 * Read the conversation state for a user.
 *
 * Returns `{ step: 'idle' }` for a fresh session. If state was previously
 * written but its `expiresAt` is in the past, returns
 * `{ step: 'idle', _expired: true }` — handlers MUST detect the marker and
 * notify the user before continuing, so a multi-step booking flow doesn't
 * silently restart (#P1-3).
 *
 * The KV TTL is set on every `setState` call as a backstop: even if a deploy
 * removes the `_expired` notice, KV will eventually evict the row.
 */
export async function getState(ctx, cid) {
  const raw = await kvGet(ctx, STATE_KEY(cid));
  if (!raw || typeof raw !== 'object') return { step: 'idle' };
  if (typeof raw.expiresAt === 'number' && raw.expiresAt < nowSec()) {
    // Explicit purge so a follow-up read in the same request sees idle.
    await kvDel(ctx, STATE_KEY(cid)).catch(() => {});
    return { step: 'idle', _expired: true };
  }
  return raw;
}

/**
 * Persist the conversation state.
 *
 * The value carries its own `expiresAt` (now + STATE_TTL_SEC) so the read
 * path can detect lapsed sessions even before KV evicts them. KV's
 * expirationTtl is also set so KV reclaims the key after the window.
 */
export async function setState(ctx, cid, s) {
  const value = { ...s, expiresAt: nowSec() + STATE_TTL_SEC };
  await kvPut(ctx, STATE_KEY(cid), value, { expirationTtl: STATE_TTL_SEC });
}

export async function clearState(ctx, cid) {
  await kvDel(ctx, STATE_KEY(cid));
}
