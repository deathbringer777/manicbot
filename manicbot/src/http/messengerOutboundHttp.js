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
import { lookupClientConvTarget } from '../services/messengerThreads.js';
import { classifyChannelSendResult } from '../channels/send-classify.js';
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
  const { tenantId, threadId, body: messageBody, messageId } = body ?? {};

  if (typeof tenantId !== 'string' || !tenantId) return bad(400, 'tenantId_required');
  if (typeof threadId !== 'string' || !threadId) return bad(400, 'threadId_required');
  if (typeof messageBody !== 'string' || !messageBody.trim()) return bad(400, 'body_required');
  if (messageBody.length > 4000) return bad(400, 'body_too_long');

  const result = await performOutboundSend(env, { tenantId, threadId, body: messageBody });

  if (result.ok) {
    return Response.json({
      ok: true,
      external_msg_id: result.externalMsgId ?? null,
      delivery_state: 'sent',
      channelType: result.channelType,
    });
  }

  // Auto-retry ONLY definitive server rejections (429 / 5xx) — never ambiguous
  // network failures (double-send risk). Enqueue when the queue binding + the
  // row id are present; the admin-app then keeps the row 'pending'.
  if (result.autoRetry && messageId && env.MESSENGER_OUTBOUND_RETRY) {
    try {
      await env.MESSENGER_OUTBOUND_RETRY.send({ tenantId, threadId, messageId, body: messageBody });
      return Response.json(
        { ok: false, error: result.errorCode, transient: true, queued: true },
        { status: 202 },
      );
    } catch (e) {
      log.warn('messengerOutbound.enqueue', { action: 'enqueue_failed', error: e?.message });
      // fall through to a plain failure response
    }
  }

  return bad(result.httpStatus ?? 502, result.errorCode ?? 'channel_send_failed', {
    transient: result.transient,
    ...(result.channelType ? { channelType: result.channelType } : {}),
  });
}

/**
 * Core outbound send: resolve the channel target → send → classify the outcome.
 * Shared by the HTTP relay (first attempt) AND the queue consumer (retries) so
 * the send logic never drifts between them.
 *
 * @returns {Promise<
 *   | { ok: true, externalMsgId: string|null, channelType: string }
 *   | { ok: false, httpStatus: number, errorCode: string, transient?: boolean, autoRetry?: boolean, channelType?: string, detail?: string }
 * >}
 */
export async function performOutboundSend(env, { tenantId, threadId, body }) {
  const ctx = await buildOutboundCtx(env, tenantId);

  const target = await lookupClientConvTarget(ctx, tenantId, threadId);
  if (!target) {
    return { ok: false, httpStatus: 404, errorCode: 'thread_not_found_or_not_client_conv', autoRetry: false };
  }

  // Web channel is delivery-less from the Worker — the client sees replies on
  // the next chat-widget poll. Treat as immediately sent (no external id).
  if (target.channelType === 'web') {
    await publishToMessengerHub(env, tenantId, {
      type: 'message.new', threadId, kind: 'client_conv', direction: 'outbound',
    }).catch(() => undefined);
    return { ok: true, externalMsgId: null, channelType: 'web' };
  }

  let channelConfig = null;
  if (target.channelType === 'whatsapp' || target.channelType === 'instagram') {
    channelConfig = await getChannelConfig(ctx, tenantId, target.channelType, env.BOT_ENCRYPTION_KEY || null);
    if (!channelConfig?.token) {
      return { ok: false, httpStatus: 503, errorCode: 'channel_token_unavailable', transient: false, autoRetry: false };
    }
  }

  const adapter = buildAdapter(target.channelType, channelConfig, ctx, env);
  if (!adapter) {
    return { ok: false, httpStatus: 501, errorCode: 'channel_not_supported', channelType: target.channelType, autoRetry: false };
  }

  if (target.channelType === 'whatsapp' || target.channelType === 'instagram') {
    const inWindow = await isWithinMessageWindow(ctx, target.channelType, String(target.channelUserId));
    if (!inWindow) {
      return { ok: false, httpStatus: 422, errorCode: 'outside_message_window', channelType: target.channelType, autoRetry: false };
    }
  }

  let sendResult;
  try {
    sendResult = await adapter.send(String(target.channelUserId), { text: body.trim() });
  } catch (e) {
    log.error('messengerOutbound.send',
      e instanceof Error ? e : new Error(String(e?.message)),
      { tenantId, threadId, channelType: target.channelType });
    // Thrown fetch = AMBIGUOUS (might have delivered) → never auto-retry.
    return { ok: false, httpStatus: 502, errorCode: 'channel_send_failed', detail: e?.message, transient: true, autoRetry: false };
  }

  const outcome = classifyChannelSendResult(sendResult);
  if (outcome.deliveryState === 'failed') {
    return {
      ok: false,
      httpStatus: 502,
      errorCode: outcome.errorCode || 'channel_send_failed',
      transient: outcome.transient,
      autoRetry: outcome.autoRetry,
      channelType: target.channelType,
    };
  }

  await publishToMessengerHub(env, tenantId, {
    type: 'message.new', threadId, kind: 'client_conv', direction: 'outbound',
  }).catch(() => undefined);

  return { ok: true, externalMsgId: outcome.externalMsgId, channelType: target.channelType };
}

