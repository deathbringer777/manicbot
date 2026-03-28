import { resolveTenantFromBotId, buildTenantCtx, buildLegacyCtx, isMigrationDone } from '../tenant/resolver.js';
import { envCtx } from './envCtx.js';

/**
 * @param {any} env
 * @param {URL} url
 * @param {Request} request
 */
export async function getCtx(env, url, request) {
  const ec = envCtx(env);
  const webhookBotMatch = url.pathname.match(/^\/webhook\/([^/]+)$/);
  if (request.method === 'POST' && webhookBotMatch) {
    const resolved = await resolveTenantFromBotId(ec, webhookBotMatch[1], env.BOT_ENCRYPTION_KEY || null);
    if (!resolved) return null;
    return buildTenantCtx(env, resolved);
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
  return buildLegacyCtx(env);
}
