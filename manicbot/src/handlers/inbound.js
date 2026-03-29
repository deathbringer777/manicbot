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
import { dbRun, dbAll } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { randomId } from '../utils/security.js';

/**
 * Handle a normalized InboundMessage from any channel.
 *
 * @param {object} ctx - Tenant context with ctx.channel set
 * @param {import('../channels/types.js').InboundMessage} inbound
 */
export async function handleInbound(ctx, inbound) {
  if (!inbound) return;

  // 1. Side-effects: message window, identity, conversation (non-blocking for Telegram)
  if (ctx.db && inbound.tenantId) {
    const sideEffects = [];

    // Message window: track last user message time for WA/IG 24h window
    if (inbound.channel !== 'telegram') {
      sideEffects.push(
        updateMessageWindow(ctx, inbound).catch(e =>
          console.error('[inbound] message_window update failed:', e.message)
        )
      );
    }

    // Channel identity: map channel_user_id → internal user if possible
    sideEffects.push(
      upsertChannelIdentity(ctx, inbound).catch(e =>
        console.error('[inbound] channel_identity upsert failed:', e.message)
      )
    );

    // Conversation: upsert the conversation row for unified inbox
    sideEffects.push(
      upsertConversation(ctx, inbound).catch(e =>
        console.error('[inbound] conversation upsert failed:', e.message)
      )
    );

    // Non-blocking — don't await, let handlers proceed immediately
    Promise.all(sideEffects).catch(() => {});
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
  await dbRun(ctx,
    `INSERT INTO message_windows (tenant_id, channel_type, channel_user_id, last_user_message_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, channel_type, channel_user_id)
     DO UPDATE SET last_user_message_at = excluded.last_user_message_at`,
    inbound.tenantId, inbound.channel, inbound.channelUserId, nowSec(),
  );
}

async function upsertChannelIdentity(ctx, inbound) {
  if (!ctx?.db || !inbound.tenantId) return;
  await dbRun(ctx,
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
  await dbRun(ctx,
    `INSERT INTO conversations (id, tenant_id, channel_type, channel_user_id, status, last_message_at, created_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    randomId(16), inbound.tenantId, inbound.channel, inbound.channelUserId, now, now,
  );
  // Update last_message_at on every message
  await dbRun(ctx,
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
  const msgId = inbound.callbackMessageId ? parseInt(inbound.callbackMessageId, 10) : 0;
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
