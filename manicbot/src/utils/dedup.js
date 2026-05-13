/**
 * @fileoverview Webhook idempotency dedup helpers.
 *
 * Telegram and Meta both retry deliveries on 5xx. Without dedup, a transient
 * 500 followed by a successful 200 still leaves the bot processing the same
 * message twice — duplicate replies, duplicate bookings, duplicate analytics.
 *
 * KV-backed: short TTL because replays only happen within the platform's
 * retry window (Telegram ~10min, Meta ~24h).
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
