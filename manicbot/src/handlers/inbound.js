/**
 * @fileoverview Unified InboundMessage dispatcher.
 *
 * Acts as the single entry point for all channels (Telegram, WhatsApp, Instagram).
 * Routes an InboundMessage to onMsg/onCb handlers, and side-effects:
 *  - Updates message_windows table for WA + IG
 *  - Upserts channel_identities
 *  - Upserts conversations table
 */

import { onMsg } from './message.js';
import { onCb } from './callback.js';
import { dbRunSafe, dbAll } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { randomId } from '../utils/security.js';
import { getLang, setLang } from '../services/chat.js';
import { log } from '../utils/logger.js';

const VALID_INBOUND_LANGS = new Set(['ru', 'en', 'ua', 'pl']);

/**
 * Handle a normalized InboundMessage from any channel.
 *
 * @param {object} ctx - Tenant context with ctx.channel set
 * @param {import('../channels/types.js').InboundMessage} inbound
 */
export async function handleInbound(ctx, inbound) {
  if (!inbound) return;

  // 1. Side-effects: message window, identity, conversation (non-blocking for Telegram)
  // Preview mode (landing demo) skips all D1 side-effect writes to avoid
  // polluting real tables with synthetic demo-session data.
  if (ctx.db && inbound.tenantId && !ctx.previewMode) {
    const sideEffects = [];

    // Message window: track last user message time for WA/IG 24h window
    if (inbound.channel !== 'telegram') {
      sideEffects.push(
        updateMessageWindow(ctx, inbound).catch(e =>
          log.error('handlers.inbound', e instanceof Error ? e : new Error(String(e.message)), { action: 'message_window_update' })
        )
      );
    }

    // Channel identity: map channel_user_id → internal user if possible
    sideEffects.push(
      upsertChannelIdentity(ctx, inbound).catch(e =>
        log.error('handlers.inbound', e instanceof Error ? e : new Error(String(e.message)), { action: 'channel_identity_upsert' })
      )
    );

    // Conversation: upsert the conversation row for unified inbox
    sideEffects.push(
      upsertConversation(ctx, inbound).catch(e =>
        log.error('handlers.inbound', e instanceof Error ? e : new Error(String(e.message)), { action: 'conversation_upsert' })
      )
    );

    // Await side-effects — fast KV/D1 writes, ensures message_window is persisted before send
    await Promise.all(sideEffects).catch(e => log.error('handlers.inbound', e instanceof Error ? e : new Error(String(e.message)), { action: 'side_effect_batch' }));
  }

  // Persist the user's preferred language as soon as we know it. The web
  // chat client passes the current LangContext value on every /chat/send,
  // so when the visitor flips the language dropdown the next bot reply
  // already comes back in the new language. Wrapped in try/catch so a
  // KV/D1 hiccup never blocks message delivery.
  try {
    const incoming = typeof inbound.userLang === 'string' ? inbound.userLang.toLowerCase() : null;
    if (incoming && VALID_INBOUND_LANGS.has(incoming)) {
      const cid = inbound.channel === 'whatsapp' || inbound.channel === 'instagram'
        ? String(inbound.channelUserId ?? '')
        : (() => {
            const n = parseInt(inbound.channelUserId, 10);
            return Number.isFinite(n) ? n : String(inbound.channelUserId ?? '');
          })();
      const current = await getLang(ctx, cid);
      if (current !== incoming) {
        await setLang(ctx, cid, incoming);
      }
    }
  } catch (e) {
    log.error('handlers.inbound', e instanceof Error ? e : new Error(String(e?.message)), { action: 'userLang_persistence' });
  }

  // 2. Route to the appropriate handler
  if (inbound.callbackData) {
    // Reconstruct a minimal callback_query object that onCb() expects
    const pseudoCb = _inboundToCb(inbound);
    return onCb(ctx, pseudoCb);
  }

  // Regular message
  const pseudoMsg = _inboundToMsg(inbound);
  return onMsg(ctx, pseudoMsg);
}

/**
 * Check if the user is within the 24-hour messaging window.
 * Used by WhatsApp/Instagram before deciding whether to send free-form or template.
 *
 * @param {object} ctx
 * @param {string} channelType
 * @param {string} channelUserId
 * @returns {Promise<boolean>}
 */
export async function isWithinMessageWindow(ctx, channelType, channelUserId) {
  if (!ctx?.db || !ctx.tenantId) return false;
  const rows = await dbAll(
    ctx,
    'SELECT last_user_message_at FROM message_windows WHERE tenant_id = ? AND channel_type = ? AND channel_user_id = ? LIMIT 1',
    ctx.tenantId, channelType, channelUserId,
  );
  if (!rows.length) return false;
  const last = rows[0].last_user_message_at;
  const windowSec = 24 * 3600;
  return (nowSec() - last) < windowSec;
}

// ── Private helpers ────────────────────────────────────────────────────────

async function updateMessageWindow(ctx, inbound) {
  if (!ctx?.db || !inbound.tenantId) return;
  await dbRunSafe(ctx,
    `INSERT INTO message_windows (tenant_id, channel_type, channel_user_id, last_user_message_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, channel_type, channel_user_id)
     DO UPDATE SET last_user_message_at = excluded.last_user_message_at`,
    inbound.tenantId, inbound.channel, inbound.channelUserId, nowSec(),
  );
}

async function upsertChannelIdentity(ctx, inbound) {
  if (!ctx?.db || !inbound.tenantId) return;
  await dbRunSafe(ctx,
    `INSERT INTO channel_identities (id, tenant_id, channel_type, channel_user_id, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, channel_type, channel_user_id)
     DO UPDATE SET display_name = COALESCE(excluded.display_name, display_name)`,
    randomId(12), inbound.tenantId, inbound.channel, inbound.channelUserId,
    inbound.userName ?? null, nowSec(),
  );
}

async function upsertConversation(ctx, inbound) {
  if (!ctx?.db || !inbound.tenantId) return;
  const now = nowSec();
  await dbRunSafe(ctx,
    `INSERT INTO conversations (id, tenant_id, channel_type, channel_user_id, status, last_message_at, created_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    randomId(16), inbound.tenantId, inbound.channel, inbound.channelUserId, now, now,
  );
  // Update last_message_at on every message
  await dbRunSafe(ctx,
    `UPDATE conversations SET last_message_at = ?, status = 'open'
     WHERE tenant_id = ? AND channel_type = ? AND channel_user_id = ?`,
    now, inbound.tenantId, inbound.channel, inbound.channelUserId,
  );
}

/**
 * Convert InboundMessage → minimal Telegram message object for onMsg().
 * Handlers that still use Telegram-specific fields get safe defaults.
 * @private
 */
function _inboundToMsg(inbound) {
  const raw = inbound.channelUserId;
  const cid =
    inbound.channel === 'whatsapp' || inbound.channel === 'instagram'
      ? String(raw ?? '')
      : (() => {
          const n = parseInt(raw, 10);
          return Number.isFinite(n) ? n : String(raw ?? '');
        })();
  return {
    chat: { id: cid, type: 'private' },
    from: {
      id: cid,
      first_name: inbound.userName ?? '',
      language_code: inbound.userLang ?? 'ru',
    },
    text: inbound.text ?? undefined,
    contact: inbound.contact
      ? { phone_number: inbound.contact.phone, first_name: inbound.contact.firstName, last_name: inbound.contact.lastName }
      : undefined,
    photo: inbound.photo ? [{ file_id: inbound.photo }] : undefined,
    date: Math.floor((inbound.timestamp ?? Date.now()) / 1000),
    _inbound: inbound, // attach for adapters that need raw data
  };
}

/**
 * Convert InboundMessage → minimal Telegram callback_query object for onCb().
 * @private
 */
function _inboundToCb(inbound) {
  const raw = inbound.channelUserId;
  const cid =
    inbound.channel === 'whatsapp' || inbound.channel === 'instagram'
      ? String(raw ?? '')
      : (() => {
          const n = parseInt(raw, 10);
          return Number.isFinite(n) ? n : String(raw ?? '');
        })();
  // msgId is opaque to the bot (only used as a handle for edit operations).
  // Telegram message ids are numeric strings — `parseInt` survives them; web
  // channel uses random hex bubble ids that must NOT be coerced. Try numeric
  // first and fall back to the original string.
  let msgId = 0;
  if (inbound.callbackMessageId) {
    const n = parseInt(inbound.callbackMessageId, 10);
    msgId = Number.isFinite(n) && String(n) === String(inbound.callbackMessageId)
      ? n
      : inbound.callbackMessageId;
  }
  return {
    id: `${inbound.channel}_${inbound.channelUserId}_${Date.now()}`,
    from: {
      id: cid,
      first_name: inbound.userName ?? '',
      language_code: inbound.userLang ?? 'ru',
    },
    message: {
      chat: { id: cid, type: 'private' },
      message_id: msgId,
    },
    data: inbound.callbackData,
    _inbound: inbound,
  };
}
