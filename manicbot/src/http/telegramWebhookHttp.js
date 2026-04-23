import { timingSafeEqual } from '../utils/security.js';
import { log } from '../utils/logger.js';
import { onMsg } from '../handlers/message.js';
import { onCb } from '../handlers/callback.js';
import { initServices } from '../services/services.js';
import { claimTelegramUpdate } from '../utils/dedup.js';

/**
 * @param {Request} request
 * @param {any} ctx
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function tryTelegramWebhook(request, ctx, url) {
  if (
    request.method !== 'POST' ||
    !(url.pathname === '/webhook' || url.pathname.match(/^\/webhook\/(?!wa$|ig$)[^/]+$/))
  ) {
    return null;
  }

  const expected = ctx.WEBHOOK_SECRET;
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  // Fail-closed: reject any webhook without a configured secret.
  // Prevents unauthenticated POSTs from forging Telegram updates.
  if (expected == null || String(expected).length < 16) {
    log.error(
      'http.telegramWebhook',
      new Error('webhook secret missing or too short — set webhookSecret in D1 bots row and re-register webhook with secret_token'),
      { botId: ctx.botId || '(legacy)' }
    );
    return new Response('Webhook not configured', { status: 503 });
  }
  if (!timingSafeEqual(secret, String(expected))) {
    return new Response('Unauthorized', { status: 403 });
  }

  if (!ctx.kv) {
    log.error('http.telegramWebhook', new Error('KV MANICBOT not bound'));
    return new Response('OK');
  }

  try {
    const upd = await request.json();

    // Sprint 2: dedup by update_id. Telegram retries on 5xx; without dedup the
    // bot processes the same message twice (duplicate replies, duplicate
    // bookings, duplicate analytics).
    if (upd?.update_id != null) {
      const botKey = ctx.botId || 'legacy';
      const fresh = await claimTelegramUpdate({ MANICBOT: ctx.kv }, botKey, upd.update_id);
      if (!fresh) return new Response('OK'); // dup, ack and skip
    }

    await initServices(ctx);

    if (upd.message) {
      if (!upd.message.chat?.id || !upd.message.from?.id) {
        return new Response('OK');
      }
      await onMsg(ctx, upd.message);
    }

    if (upd.callback_query) {
      if (!upd.callback_query.message?.chat?.id || !upd.callback_query.from?.id || !upd.callback_query.data) {
        return new Response('OK');
      }
      await onCb(ctx, upd.callback_query);
    }
  } catch (e) {
    log.error('http.telegramWebhook', e instanceof Error ? e : new Error(String(e.message)));
  }
  return new Response('OK');
}
