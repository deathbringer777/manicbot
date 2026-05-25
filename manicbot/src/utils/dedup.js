/**
 * @fileoverview Webhook idempotency dedup helpers.
 *
 * Telegram and Meta both retry deliveries on 5xx. Without dedup, a transient
 * 500 followed by a successful 200 still leaves the bot processing the same
 * message twice — duplicate replies, duplicate bookings, duplicate analytics.
 *
 * ## Backends
 *
 * Three pluggable backends, selected by `env.WEBHOOK_DEDUP_BACKEND`:
 *
 *   - `"kv"`   — legacy GET-then-PUT against Workers KV. Race-prone
 *                under truly concurrent claims (KV has no CAS); kept for
 *                instant rollback if D1 misbehaves at the edge.
 *
 *   - `"d1"`   — atomic INSERT ... ON CONFLICT DO NOTHING against the
 *                `webhook_dedup` D1 table (migration 0089). SQLite is
 *                strongly consistent; exactly one row creation wins,
 *                others get `meta.changes = 0` and recognize the
 *                duplicate. This is the production target.
 *
 *   - `"dual"` — write to BOTH (D1 first for the verdict, KV as an
 *                audit mirror). Default during the rollout window so
 *                we can flip back to `"kv"` instantly if needed
 *                without losing the in-flight claim corpus.
 *
 * When the env var is unset, the default is `"dual"`. When the chosen
 * backend's binding is missing (e.g. `"d1"` but `env.DB` unbound in a
 * local-dev or test setup), the helper falls back to the other backend
 * if present, else returns `true` (allow through) — analytics is more
 * important than perfect dedup in a degraded environment.
 *
 * ## TTLs
 *
 * - Telegram: 5 min (Telegram retries within ~5 min)
 * - Meta (IG/WA): 24h (Meta retries for up to 24 h on 5xx)
 * - claimOnce: caller-supplied (default 5 min)
 *
 * Old rows are pruned by the `phaseWebhookDedupCleanup` cron phase.
 * The TTL window is for storage cleanup, not correctness: once a key
 * is in the table, it dedups until cleanup removes it.
 *
 * ## Migration history
 *
 * KV-only era: GET-then-PUT, documented race under <~5s convergence.
 * D1 era (migration 0089, this file): atomic CAS via SQLite UNIQUE.
 * Pre-launch remediation Blocker 3 (2026-05-25).
 */

import { nowSec } from './time.js';

const TG_TTL_SEC = 300;
const META_TTL_SEC = 86_400;

/**
 * Resolve the active backend label. Falls back to `"dual"` when unset.
 */
function resolveBackend(env) {
  const v = env?.WEBHOOK_DEDUP_BACKEND;
  if (v === 'kv' || v === 'd1' || v === 'dual') return v;
  return 'dual';
}

function getKv(env) {
  return env?.MANICBOT || env?.kv || null;
}

function getDb(env) {
  return env?.DB || env?.db || null;
}

/**
 * Core claim primitive. Returns `true` if this is the first time the
 * key was seen (caller processes), `false` if a previous claim already
 * happened (caller acks + skips).
 *
 * Backend-aware. Never throws — internal errors degrade to allow-through
 * because letting a webhook process twice is less bad than letting a
 * 5xx storm at our infrastructure.
 *
 * @param {object} env - Worker bindings (env.DB, env.MANICBOT, env.WEBHOOK_DEDUP_BACKEND)
 * @param {string} key - canonical dedup key, e.g. "tg:upd:{botId}:{updateId}"
 * @param {number} ttlSec
 * @returns {Promise<boolean>}
 */
async function _claim(env, key, ttlSec) {
  const backend = resolveBackend(env);
  const kv = getKv(env);
  const db = getDb(env);

  // No bindings at all (legacy/test ctx) — degrade to allow-through.
  if (!kv && !db) return true;

  // Pure D1 path — falls through to KV if DB binding missing.
  if (backend === 'd1') {
    if (db) return _claimD1(db, key, ttlSec);
    if (kv) return _claimKv(kv, key, ttlSec);
    return true;
  }

  // Pure KV path.
  if (backend === 'kv') {
    if (kv) return _claimKv(kv, key, ttlSec);
    if (db) return _claimD1(db, key, ttlSec);
    return true;
  }

  // Dual: D1 is the source of truth for the verdict; KV is audit mirror.
  if (db) {
    const verdict = await _claimD1(db, key, ttlSec);
    if (kv && verdict) {
      // Mirror the claim into KV for instant rollback to the legacy
      // backend. Failures are non-fatal — D1 already gave the verdict.
      try {
        await kv.put(key, '1', { expirationTtl: ttlSec });
      } catch { /* ignore audit-mirror failure */ }
    }
    return verdict;
  }
  if (kv) return _claimKv(kv, key, ttlSec);
  return true;
}

/**
 * KV-backed claim. GET → if absent, PUT. Race-prone under truly
 * concurrent calls (KV has no CAS).
 */
async function _claimKv(kv, key, ttlSec) {
  try {
    const seen = await kv.get(key);
    if (seen) return false;
    await kv.put(key, '1', { expirationTtl: ttlSec });
    return true;
  } catch {
    // KV upstream blip — allow through.
    return true;
  }
}

/**
 * D1-backed claim. Atomic INSERT ... ON CONFLICT DO NOTHING.
 * `meta.changes === 1` iff this call won the claim.
 */
async function _claimD1(db, key, ttlSec) {
  if (!db?.prepare) return true;
  const now = nowSec();
  try {
    const res = await db
      .prepare(
        `INSERT INTO webhook_dedup (key, expires_at, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING`,
      )
      .bind(key, now + ttlSec, now)
      .run();
    return (res?.meta?.changes ?? 0) === 1;
  } catch {
    // D1 unavailable / migration not applied yet — allow through.
    return true;
  }
}

/**
 * Cleanup phase entry: prune dedup rows past their TTL. Called from
 * `src/handlers/cron.js` `phaseWebhookDedupCleanup` once per 15-min
 * cron tick. With Telegram TTL = 5 min and Meta TTL = 24 h the live
 * working set never exceeds a few thousand rows even at full launch
 * load.
 *
 * @param {{ DB?: D1Database, db?: D1Database }} env
 * @returns {Promise<{ deleted: number }>}
 */
export async function pruneExpiredDedupRows(env) {
  const db = getDb(env);
  if (!db?.prepare) return { deleted: 0 };
  try {
    const res = await db
      .prepare(`DELETE FROM webhook_dedup WHERE expires_at < ?`)
      .bind(nowSec())
      .run();
    return { deleted: res?.meta?.changes ?? 0 };
  } catch {
    return { deleted: 0 };
  }
}

// ─── Public API (signatures preserved from the KV-only era) ──────────────────

/**
 * Check + claim a Telegram update. Returns true if first-seen.
 *
 * @param {object} env
 * @param {string|number} botId
 * @param {string|number} updateId
 * @returns {Promise<boolean>}
 */
export async function claimTelegramUpdate(env, botId, updateId) {
  return _claim(env, `tg:upd:${botId}:${updateId}`, TG_TTL_SEC);
}

/**
 * Check + claim an Instagram message id (mid).
 *
 * @param {object} env
 * @param {string} pageId
 * @param {string} mid
 * @returns {Promise<boolean>}
 */
export async function claimMetaMessage(env, pageId, mid) {
  return _claim(env, `ig:msg:${pageId}:${mid}`, META_TTL_SEC);
}

/**
 * Check + claim a WhatsApp message id (wamid).
 *
 * @param {object} env
 * @param {string} phoneNumberId
 * @param {string} wamid
 * @returns {Promise<boolean>}
 */
export async function claimWAMessage(env, phoneNumberId, wamid) {
  return _claim(env, `wa:msg:${phoneNumberId}:${wamid}`, META_TTL_SEC);
}

/**
 * Generic claim helper for arbitrary keys.
 *
 * @param {object} env
 * @param {string} key
 * @param {number} [ttlSec=300]
 * @returns {Promise<boolean>}
 */
export async function claimOnce(env, key, ttlSec = TG_TTL_SEC) {
  return _claim(env, key, ttlSec);
}
