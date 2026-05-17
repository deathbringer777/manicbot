/**
 * @fileoverview POST /admin/messenger-outbound — staff → client relay.
 *
 * Called by the admin-app's `messenger.sendMessage` mutation when a staff
 * member sends a non-internal-note message into a `client_conv` thread.
 *
 * Flow:
 *   1. Authenticate via ADMIN_KEY Bearer (same as other /admin/* routes).
 *   2. Resolve the thread → conversations row → (channel_type, channel_user_id).
 *   3. Build a channel adapter for the resolved tenant + channel.
 *   4. For WhatsApp/Instagram, verify we're inside the 24h messaging window
 *      via `isWithinMessageWindow`. Outside → 422 with `outside_message_window`.
 *   5. Adapter.send the message. On success, append a `thread_messages` row
 *      (sender_kind='system', sender_ref='channel-relay') and return
 *      `{ ok: true, messageId, external_msg_id }`.
 *   6. On adapter error → 502 with the channel error code so the UI can
 *      surface "switch to template" / "retry later" hints.
 *
 * Body schema:
 *   {
 *     tenantId: string,
 *     threadId: string,
 *     body: string,
 *     replyToMessageId?: string
 *   }
 */

import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';
import {
  appendOutboundStaffMessage,
  lookupClientConvTarget,
} from '../services/messengerThreads.js';
import { getChannelConfig } from '../channels/resolver.js';
import { TelegramAdapter } from '../channels/telegram.js';
import { WhatsAppAdapter } from '../channels/whatsapp.js';
import { InstagramAdapter } from '../channels/instagram.js';
import { isWithinMessageWindow } from '../handlers/inbound.js';
import { publishToMessengerHub } from './messengerWsHttp.js';

function bad(status, error, extra) {
  return Response.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

function isAdminKeyValid(env, request) {
  if (!env.ADMIN_KEY) return false;
  const authHeader = request?.headers?.get?.('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  return timingSafeEqual(authHeader.slice(7), env.ADMIN_KEY);
}

/**
 * Build the right ChannelAdapter for the resolved channel type. Returns null
 * if the channel isn't supported by this endpoint (web is delivery-less from
 * the Worker side — the customer sees replies on next chat-widget refresh).
 *
 * @param {string} channelType
 * @param {object} channelConfig - row from channel_configs with decrypted token
 * @param {object} ctx - tenant ctx (used by adapters for window checks)
 * @param {object} env - Worker env (for tokens etc.)
 */
function buildAdapter(channelType, channelConfig, ctx, env) {
  switch (channelType) {
    case 'telegram':
      // Telegram outbound uses the tenant's bot token, NOT a channel_configs row.
      return ctx?.TG ? new TelegramAdapter(ctx.TG) : null;
    case 'whatsapp':
      return channelConfig?.token ? new WhatsAppAdapter(channelConfig, ctx) : null;
    case 'instagram':
      return channelConfig?.token ? new InstagramAdapter(channelConfig, ctx) : null;
    default:
      return null;
  }
}

/**
 * Build a minimal tenant ctx for an outbound send. Lighter than `buildChannelCtx`
 * — we just need db + token wiring for the channel.
 */
async function buildOutboundCtx(env, tenantId) {
  const ec = {
    db: env.DB || null,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    BOT_ENCRYPTION_KEY: env.BOT_ENCRYPTION_KEY || null,
    BOT_ENCRYPTION_KEY_OLD: env.BOT_ENCRYPTION_KEY_OLD || null,
    META_APP_SECRET: env.META_APP_SECRET || null,
    META_APP_ID: env.META_APP_ID || null,
    META_INSTAGRAM_APP_SECRET: env.META_INSTAGRAM_APP_SECRET || null,
    tenantId,
  };
  // Pull bot token for Telegram outbound (lazy — only if used).
  try {
    const { getBotIdsByTenantId, getBotToken } = await import('../tenant/storage.js');
    const botIds = await getBotIdsByTenantId(ec, tenantId);
    if (botIds.length) {
      const botToken = await getBotToken(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null);
      if (botToken) ec.TG = `https://api.telegram.org/bot${botToken}`;
    }
  } catch (e) {
    log.warn('messengerOutbound.ctx', { action: 'bot_token_lookup_failed', error: e?.message });
  }
  return ec;
}

/**
 * Route handler. Returns a Response or null if path/method didn't match.
 */
export async function tryMessengerOutboundRoute(request, env, url) {
  if (url.pathname !== '/admin/messenger-outbound') return null;
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!isAdminKeyValid(env, request)) return new Response('Forbidden', { status: 403 });
  if (!env.DB) return bad(500, 'db_not_bound');

  let body;
  try {
    body = await request.json();
  } catch {
    return bad(400, 'invalid_json');
  }
  const { tenantId, threadId, body: messageBody, replyToMessageId } = body ?? {};

  if (typeof tenantId !== 'string' || !tenantId) return bad(400, 'tenantId_required');
  if (typeof threadId !== 'string' || !threadId) return bad(400, 'threadId_required');
  if (typeof messageBody !== 'string' || !messageBody.trim()) return bad(400, 'body_required');
  if (messageBody.length > 4000) return bad(400, 'body_too_long');

  const ctx = await buildOutboundCtx(env, tenantId);

  // Lookup thread + conversation target
  const target = await lookupClientConvTarget(ctx, tenantId, threadId);
  if (!target) {
    return bad(404, 'thread_not_found_or_not_client_conv');
  }

  // Resolve channel config (skip for telegram — uses bot token)
  let channelConfig = null;
  if (target.channelType === 'whatsapp' || target.channelType === 'instagram') {
    channelConfig = await getChannelConfig(
      ctx, tenantId, target.channelType, env.BOT_ENCRYPTION_KEY || null,
    );
    if (!channelConfig?.token) {
      return bad(503, 'channel_token_unavailable');
    }
  }

  // Build adapter
  const adapter = buildAdapter(target.channelType, channelConfig, ctx, env);
  if (!adapter) {
    return bad(501, 'channel_not_supported', { channelType: target.channelType });
  }

  // 24h window guard for WA / IG
  if (target.channelType === 'whatsapp' || target.channelType === 'instagram') {
    const inWindow = await isWithinMessageWindow(
      ctx, target.channelType, String(target.channelUserId),
    );
    if (!inWindow) {
      return bad(422, 'outside_message_window', { channelType: target.channelType });
    }
  }

  // Send
  let sendResult;
  try {
    sendResult = await adapter.send(String(target.channelUserId), {
      text: messageBody.trim(),
    });
  } catch (e) {
    log.error('messengerOutbound.send',
      e instanceof Error ? e : new Error(String(e?.message)),
      { tenantId, threadId, channelType: target.channelType });
    return bad(502, 'channel_send_failed', { detail: e?.message });
  }
  if (sendResult && sendResult.ok === false) {
    return bad(502, sendResult.error || 'channel_send_failed');
  }

  const externalMsgId =
    sendResult?.external_msg_id ??
    sendResult?.message_id ??
    sendResult?.messages?.[0]?.id ??
    sendResult?.result?.message_id ??
    null;

  // Stamp into thread_messages — append a relay row so the timeline shows
  // staff replies came from the channel adapter. (admin-app's sendMessage
  // also writes a sender_kind='web_user' row; the relay row is a delivery
  // receipt with sender_kind='system'.)
  const appended = await appendOutboundStaffMessage(ctx, {
    tenantId,
    threadId,
    body: messageBody.trim(),
    externalMsgId: externalMsgId ? String(externalMsgId) : '',
    replyToMessageId: replyToMessageId ?? null,
  });

  // Phase 3 — broadcast the outbound delivery to other open /messages tabs
  // (e.g. another owner browser session, or the same user on a phone).
  await publishToMessengerHub(env, tenantId, {
    type: 'message.new',
    threadId,
    messageId: appended?.messageId ?? null,
    kind: 'client_conv',
    direction: 'outbound',
  }).catch(() => undefined);

  return Response.json({
    ok: true,
    messageId: appended?.messageId ?? null,
    external_msg_id: externalMsgId,
    channelType: target.channelType,
  });
}

