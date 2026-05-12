import { resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx, isMigrationDone } from '../tenant/resolver.js';
import { envCtx } from './envCtx.js';

/**
 * P2-3 — Legacy single-bot ctx (env BOT_TOKEN + WEBHOOK_SECRET) is now opt-in.
 *
 * Once migration 0048 shipped bot tokens to D1 + per-bot encryption, the
 * `buildLegacyCtx` branch became dead code in production. The risk: a future
 * operator setting BOT_TOKEN env (e.g. for a smoke test) silently bypasses D1
 * and the encryption layer.
 *
 * To re-enable, set the Worker var `ALLOW_LEGACY_BOT_CTX=1`. A `[SECURITY]`
 * startup warning is logged by `validateSecurityConfig` whenever the flag is
 * set, so operators see it in every deploy.
 *
 * @param {any} env
 * @param {URL} url
 * @param {Request} request
 */
export async function getCtx(env, url, request) {
  const ec = envCtx(env);
  const webhookBotMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (request.method === 'POST' && webhookBotMatch) {
    const seg = webhookBotMatch[1];
    // Meta WhatsApp / Instagram — not Telegram bot ids (see tryMetaWebhooks, tryTelegramWebhook)
    if (seg !== 'wa' && seg !== 'ig') {
      const resolved = await resolveTenantFromBotId(ec, seg, env.BOT_ENCRYPTION_KEY || null);
      if (!resolved) return null;
      return buildTenantCtx(env, resolved);
    }
  }
  // Optional: forbid legacy POST /webhook (no botId) when D1 is bound — use /webhook/{botId} only.
  if (
    request.method === 'POST' &&
    url.pathname === '/webhook' &&
    env.REQUIRE_WEBHOOK_BOT_ID === '1' &&
    ec.db
  ) {
    return null;
  }
  if (!env.BOT_TOKEN) return null;
  const botId = env.BOT_TOKEN.split(':')[0];
  if (ec.db && (await isMigrationDone(ec, botId))) {
    const resolved = await resolveTenantFromBotId(ec, botId, env.BOT_ENCRYPTION_KEY || null);
    if (resolved) return buildTenantCtx(env, resolved);
  }
  // Legacy ctx is now opt-in. Default → 404 (caller handles).
  if (env.ALLOW_LEGACY_BOT_CTX === '1') return buildLegacyCtx(env);
  return null;
}
