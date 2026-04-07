import { timingSafeEqual } from '../utils/security.js';
import { onMsg } from '../handlers/message.js';
import { onCb } from '../handlers/callback.js';
import { initServices } from '../services/services.js';

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
    console.error(
      '[telegram-webhook] webhook secret missing or too short for bot',
      ctx.botId || '(legacy)',
      '— set webhookSecret in D1 bots row and re-register webhook with secret_token.'
    );
    return new Response('Webhook not configured', { status: 503 });
  }
  if (!timingSafeEqual(secret, String(expected))) {
    return new Response('Unauthorized', { status: 403 });
  }

  if (!ctx.kv) {
    console.error('KV MANICBOT not bound');
    return new Response('OK');
  }

  try {
    const upd = await request.json();

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
    console.error('Webhook error:', e.message, e.stack);
  }
  return new Response('OK');
}
