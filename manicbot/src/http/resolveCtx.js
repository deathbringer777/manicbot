import { resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx, isMigrationDone } from '../tenant/resolver.js';
import { envCtx } from './envCtx.js';
import { buildAdminBotCtx, adminBotId } from '../adminbot/ctx.js';
import { getTenantIdByBotId } from '../tenant/storage.js';
import { log } from '../utils/logger.js';

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
    // Admin/ops bot interception (system_admin) — MUST run before tenant
    // resolution so the tenant-less admin ctx is used. Enabled only when the
    // admin webhook secret is configured. HIJACK GUARD: if this botId is a
    // registered client bot, refuse to treat it as the admin bot and fall
    // through to normal tenant resolution (never steal a salon's updates).
    const adminId = adminBotId(env);
    if (adminId && seg === adminId && env.ADMIN_WEBHOOK_SECRET) {
      const clientTenant = ec.db ? await getTenantIdByBotId(ec, seg) : null;
      if (clientTenant) {
        log.error('http.resolveCtx', new Error('admin botId collides with a registered client bot — admin bot disabled for this id'), { botId: seg, tenantId: clientTenant });
      } else {
        const adminCtx = buildAdminBotCtx(env);
        if (adminCtx) return adminCtx;
      }
    }
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
