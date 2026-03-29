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
  if (expected == null || String(expected).length === 0) {
    console.error('[telegram-webhook] WEBHOOK_SECRET missing for this bot; set secret in D1 bots row or env and re-register webhook');
    return new Response('Webhook not configured', { status: 500 });
  }
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!timingSafeEqual(secret, expected)) {
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
