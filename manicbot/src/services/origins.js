/**
 * User origin tracking service.
 *
 * Decodes Telegram /start payloads and WhatsApp click-to-chat prefixes into
 * a canonical `{source, medium, campaign, content}` shape and writes it to the
 * `user_origins` table, with denormalized first-touch attribution on `users`.
 *
 * Multi-touch model: every touch is appended to `user_origins`; `users.first_*`
 * is only written once (the first time we see this chat_id for this tenant).
 */

import { dbGet, dbRunSafe } from '../utils/db.js';
import { logEvent } from '../utils/events.js';

/** Allowed channel values — matches `channel_configs.channel_type`. */
export const ORIGIN_CHANNELS = new Set(['telegram', 'whatsapp', 'instagram', 'web']);

/** Short-key aliases written into the compact JSON payload (keeps /start under TG's 64-char limit). */
const SHORT_KEY_MAP = {
  s: 'source',
  m: 'medium',
  c: 'campaign',
  ct: 'content',
};

/**
 * Decode a Telegram `/start <payload>` or a WhatsApp click-to-chat preface.
 *
 * Accepts:
 *   (a) base64url-encoded compact JSON:  eyJzIjoicXIiLCJjIjoiYXByIn0   → {source:'qr', campaign:'apr'}
 *   (b) plain-JSON (rare, for debugging): {"s":"qr","c":"apr"}
 *   (c) simple source-only token:        qr_april_2026                → {source:'qr_april_2026'}
 *
 * Returns `null` for malformed input so the caller can decide to drop or log.
 *
 * @param {string} payload
 * @returns {{source?:string, medium?:string, campaign?:string, content?:string}|null}
 */
export function decodeStartPayload(payload) {
  if (!payload || typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) return null; // defensive — Telegram caps at 64 but WA/IG are bigger

  // (a) base64url JSON. If the string decodes cleanly to an object literal,
  //     we commit to that interpretation — either return the mapped keys or
  //     null (no fall-through). This prevents a random base64 like
  //     "eyJmb28iOiJiYXIifQ" from being mis-classified as a simple source token.
  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length >= 4) {
    try {
      const padded = trimmed.replace(/-/g, '+').replace(/_/g, '/') +
        '==='.slice((trimmed.length + 3) % 4);
      const decoded = atob(padded);
      if (decoded.startsWith('{') && decoded.endsWith('}')) {
        try {
          const obj = JSON.parse(decoded);
          return mapShortKeys(obj); // null if no recognized keys
        } catch {
          /* malformed JSON — fall through to simple-token check */
        }
      }
    } catch {
      /* not valid base64 — fall through to other strategies */
    }
  }

  // (b) plain JSON (debug/manual)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const mapped = mapShortKeys(JSON.parse(trimmed));
      if (mapped) return mapped;
    } catch {
      /* fall through */
    }
  }

  // (c) simple source-only token: [A-Za-z0-9_-]{1,64}
  if (/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) {
    return { source: trimmed };
  }

  return null;
}

function mapShortKeys(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [shortKey, fullKey] of Object.entries(SHORT_KEY_MAP)) {
    if (typeof raw[shortKey] === 'string' && raw[shortKey]) out[fullKey] = raw[shortKey].slice(0, 120);
    else if (typeof raw[fullKey] === 'string' && raw[fullKey]) out[fullKey] = raw[fullKey].slice(0, 120);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Encode a tracking payload back to the compact base64url JSON form.
 * Mirror of `decodeStartPayload` for use by the link generator.
 *
 * Throws if the result would exceed `maxLen` bytes (Telegram's /start limit is 64).
 */
export function encodeStartPayload({ source, medium, campaign, content } = {}, maxLen = 64) {
  const obj = {};
  if (source) obj.s = String(source).slice(0, 120);
  if (medium) obj.m = String(medium).slice(0, 120);
  if (campaign) obj.c = String(campaign).slice(0, 120);
  if (content) obj.ct = String(content).slice(0, 120);
  if (Object.keys(obj).length === 0) throw new Error('encodeStartPayload: empty object');

  const json = JSON.stringify(obj);
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (b64.length > maxLen) {
    throw new Error(`encodeStartPayload: token exceeds maxLen ${maxLen} (got ${b64.length})`);
  }
  return b64;
}

/**
 * Record an origin touch for a (tenantId, chatId) pair.
 *
 * Idempotency: safe to call multiple times — each call inserts a new row, but
 * the denormalized first-touch on `users` is only written once.
 *
 * @param {object} ctx   tenant context (needs `db`, `tenantId`)
 * @param {object} touch
 * @param {number} touch.chatId
 * @param {string} touch.channel
 * @param {string} [touch.source]
 * @param {string} [touch.medium]
 * @param {string} [touch.campaign]
 * @param {string} [touch.content]
 * @param {string} [touch.landingUrl]
 * @param {string} [touch.referer]
 * @param {string} [touch.rawPayload]
 * @returns {Promise<{ok:boolean, isFirstTouch?:boolean, reason?:string}>}
 */
export async function recordOrigin(ctx, touch) {
  if (!ctx?.db || !ctx?.tenantId) return { ok: false, reason: 'no ctx' };
  if (!touch?.chatId || !touch?.channel) return { ok: false, reason: 'missing chatId/channel' };
  if (!ORIGIN_CHANNELS.has(touch.channel)) return { ok: false, reason: 'invalid channel' };

  const now = Math.floor(Date.now() / 1000);
  const existing = await dbGet(
    ctx,
    'SELECT first_touch_at FROM users WHERE tenant_id = ? AND chat_id = ?',
    ctx.tenantId,
    touch.chatId,
  );
  const isFirstTouch = !existing?.first_touch_at;

  const insertResult = await dbRunSafe(
    ctx,
    `INSERT INTO user_origins
       (tenant_id, chat_id, channel, source, medium, campaign, content, landing_url, referer, raw_payload, captured_at, is_first_touch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ctx.tenantId,
    touch.chatId,
    touch.channel,
    touch.source || null,
    touch.medium || null,
    touch.campaign || null,
    touch.content || null,
    touch.landingUrl || null,
    touch.referer || null,
    touch.rawPayload || null,
    now,
    isFirstTouch ? 1 : 0,
  );

  if (!insertResult.ok) {
    return { ok: false, reason: insertResult.error || 'insert failed' };
  }

  if (isFirstTouch) {
    await dbRunSafe(
      ctx,
      `UPDATE users
         SET first_source = ?, first_campaign = ?, first_medium = ?, first_touch_at = ?
       WHERE tenant_id = ? AND chat_id = ?`,
      touch.source || null,
      touch.campaign || null,
      touch.medium || null,
      now,
      ctx.tenantId,
      touch.chatId,
    );
    void logEvent(ctx, 'user.origin.first_touch', {
      tenantId: ctx.tenantId,
      level: 'info',
      message: `first touch chat=${touch.chatId} src=${touch.source || '—'}`,
      data: { chatId: touch.chatId, channel: touch.channel, source: touch.source, campaign: touch.campaign },
    });
  }

  return { ok: true, isFirstTouch };
}
