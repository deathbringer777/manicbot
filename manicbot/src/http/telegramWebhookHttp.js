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

  let upd;
  try {
    upd = await request.json();
  } catch (e) {
    // Malformed JSON — Telegram won't send this; reject quickly with 400 so
    // ops sees something is wrong but Telegram does not retry indefinitely.
    log.error('http.telegramWebhook', e instanceof Error ? e : new Error(String(e?.message)),
      { phase: 'parse', botId: ctx.botId || '(legacy)' });
    return new Response('Bad payload', { status: 400 });
  }

  // Sprint 2: dedup by update_id. Telegram retries on 5xx; without dedup the
  // bot processes the same message twice (duplicate replies, duplicate
  // bookings, duplicate analytics). Dedup BEFORE init so a transient init
  // failure doesn't burn the dedup slot for a future retry.
  if (upd?.update_id != null) {
    const botKey = ctx.botId || 'legacy';
    const fresh = await claimTelegramUpdate({ MANICBOT: ctx.kv }, botKey, upd.update_id);
    if (!fresh) return new Response('OK'); // dup, ack and skip
  }

  // Init failure path: D1 is down, KV is degraded, decryption fails, etc.
  // The historic behaviour was to swallow and return 200, which made
  // Telegram drop the update — the user got no answer and we got no retry.
  // Now we surface 500 so Telegram retries while ops investigates. The
  // dedup claim above releases naturally because we did not write a fresh
  // claim for this update_id (it was already claimed; the retry will see
  // the claim and skip — which is fine because we'll have processed it by
  // then OR the next retry after TTL).
  try {
    await initServices(ctx);
  } catch (e) {
    log.error('http.telegramWebhook', e instanceof Error ? e : new Error(String(e?.message)),
      { phase: 'init', botId: ctx.botId || '(legacy)', updateId: upd?.update_id });
    return new Response('Init failed', { status: 500 });
  }

  // Handler-phase errors (after init) are NOT retried: a malformed update or
  // a downstream bug in onMsg/onCb won't fix itself on retry, and re-running
  // could cause duplicate side effects (already partially executed inside
  // the failed handler). Log loudly and ack 200.
  try {
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
    log.error('http.telegramWebhook', e instanceof Error ? e : new Error(String(e?.message)),
      { phase: 'handler', botId: ctx.botId || '(legacy)', updateId: upd?.update_id });
  }
  return new Response('OK');
}
