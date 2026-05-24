/**
 * @fileoverview Webhook idempotency dedup helpers.
 *
 * Telegram and Meta both retry deliveries on 5xx. Without dedup, a transient
 * 500 followed by a successful 200 still leaves the bot processing the same
 * message twice — duplicate replies, duplicate bookings, duplicate analytics.
 *
 * KV-backed: short TTL because replays only happen within the platform's
 * retry window (Telegram ~10min, Meta ~24h).
 *
 * ## Concurrency / eventual-consistency caveat
 *
 * Cloudflare Workers KV is globally distributed and eventually consistent.
 * It has no compare-and-swap / conditional-PUT primitive, so these claim
 * helpers use a GET-then-PUT pattern. Two truly concurrent claims for the
 * same key against the SAME edge node race on a window of <~100ms; against
 * DIFFERENT edge nodes the window can extend to KV's convergence time
 * (typically <1s, occasionally a few seconds).
 *
 * In practice this is acceptable here because:
 *   - Telegram retries are spaced ≥1s apart (and only on 5xx).
 *   - Meta WA/IG retries are spaced ≥5s apart with exponential backoff.
 *   - The original webhook delivery is single-shot; the race only exists
 *     between original + retry, never original + original.
 *
 * If true at-most-once semantics are ever required (e.g. for billing-bearing
 * webhooks), migrate the claim into a Durable Object (single-writer, strong
 * consistency) — the function signatures here are intentionally narrow so
 * the call sites need only swap the implementation, not the API.
 *
 * TODO(2026-05-24 audit #3, deferred): the pre-launch audit re-flagged this
 * theoretical race. We chose not to address it now because in practice
 * Meta's ≥5s retry spacing makes the window unreachable, and a Durable
 * Object migration is a 1-2 day project (binding, migration plan, cold-start
 * cost). When DO migration happens, the swap is:
 *   - bind a `WEBHOOK_DEDUP` Durable Object class
 *   - replace `kv.get` / `kv.put` here with `stub.fetch('/claim?key=...')`
 *   - the DO holds an in-memory set + persists to its private storage; CAS
 *     is implicit because the DO is single-threaded per id.
 */

const TG_TTL_SEC = 300;     // Telegram retries within ~5 min
const META_TTL_SEC = 86_400; // Meta retries within 24h

/**
 * Check + claim a Telegram update. Returns true if this is the first time
 * we've seen it (caller should process); false if already seen (caller should
 * ack and skip).
 *
 * @param {{ MANICBOT?: KVNamespace, kv?: KVNamespace }} env
 * @param {string|number} botId
 * @param {string|number} updateId
 * @returns {Promise<boolean>}
 */
export async function claimTelegramUpdate(env, botId, updateId) {
  const kv = env?.MANICBOT || env?.kv;
  if (!kv?.put || !kv?.get) return true; // No KV = can't dedup, allow through
  const key = `tg:upd:${botId}:${updateId}`;
  const seen = await kv.get(key);
  if (seen) return false;
  await kv.put(key, '1', { expirationTtl: TG_TTL_SEC });
  return true;
}

/**
 * Check + claim a Meta message id (mid).
 * @param {{ MANICBOT?: KVNamespace, kv?: KVNamespace }} env
 * @param {string} pageId
 * @param {string} mid
 * @returns {Promise<boolean>}
 */
export async function claimMetaMessage(env, pageId, mid) {
  const kv = env?.MANICBOT || env?.kv;
  if (!kv?.put || !kv?.get) return true;
  const key = `ig:msg:${pageId}:${mid}`;
  const seen = await kv.get(key);
  if (seen) return false;
  await kv.put(key, '1', { expirationTtl: META_TTL_SEC });
  return true;
}

/**
 * Check + claim a WhatsApp message id (wamid). Meta retries WA webhooks for
 * up to 24h on 5xx — without dedup every retry replays the message into the
 * bot, producing duplicate AI replies, duplicate bookings, duplicate
 * analytics. Mirrors `claimMetaMessage` but uses a distinct key prefix so
 * IG and WA dedup namespaces never collide.
 *
 * @param {{ MANICBOT?: KVNamespace, kv?: KVNamespace }} env
 * @param {string} phoneNumberId - WA business phone number id (from value.metadata)
 * @param {string} wamid - WA message id (from value.messages[].id)
 * @returns {Promise<boolean>} true if first-seen (process); false if duplicate (skip)
 */
export async function claimWAMessage(env, phoneNumberId, wamid) {
  const kv = env?.MANICBOT || env?.kv;
  if (!kv?.put || !kv?.get) return true;
  const key = `wa:msg:${phoneNumberId}:${wamid}`;
  const seen = await kv.get(key);
  if (seen) return false;
  await kv.put(key, '1', { expirationTtl: META_TTL_SEC });
  return true;
}

/**
 * Generic claim helper for arbitrary keys.
 * @param {{ MANICBOT?: KVNamespace, kv?: KVNamespace }} env
 * @param {string} key
 * @param {number} [ttlSec=300]
 * @returns {Promise<boolean>}
 */
export async function claimOnce(env, key, ttlSec = 300) {
  const kv = env?.MANICBOT || env?.kv;
  if (!kv?.put || !kv?.get) return true;
  const seen = await kv.get(key);
  if (seen) return false;
  await kv.put(key, '1', { expirationTtl: ttlSec });
  return true;
}
