/**
 * Resolve tenant and bot from webhook request.
 * Supports: /webhook (legacy, use env BOT_TOKEN) and /webhook/{botId} (from registry).
 */

import { getTenant, getTenantIdByBotId, getBot, getBotToken } from './storage.js';

const DEFAULT_TENANT_ID = 'default';

/**
 * Resolve tenant from bot ID (from KV registry).
 * @param {KVNamespace} kv
 * @param {string} botId
 * @param {string} [encryptionKey] - BOT_ENCRYPTION_KEY for decrypting token
 * @returns {Promise<{ tenantId: string, tenant: object, bot: object, TG: string } | null>}
 */
export async function resolveTenantFromBotId(kv, botId, encryptionKey = null) {
  if (!kv || !botId) return null;
  const tenantId = await getTenantIdByBotId(kv, botId);
  if (!tenantId) return null;
  const [tenant, bot] = await Promise.all([getTenant(kv, tenantId), getBot(kv, botId)]);
  if (!tenant || !bot || !bot.active) return null;
  const token = await getBotToken(kv, botId, encryptionKey);
  if (!token) return null;
  return {
    tenantId,
    tenant,
    bot: { ...bot, botToken: token },
    TG: `https://api.telegram.org/bot${token}`,
  };
}

/**
 * Build tenant-scoped context for request processing.
 * ctx.prefix = "t:{tenantId}:" so all kvGet/kvPut use tenant scope.
 */
export function buildTenantCtx(env, resolved) {
  const { tenantId, tenant, bot, TG } = resolved;
  const prefix = `t:${tenantId}:`;
  return {
    ...env,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    tenantId,
    tenant,
    bot,
    TG,
    prefix,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: bot.webhookSecret,
    // God mode (ADMIN_CHAT_ID) only in main bot — tenant bots must not expose sysadmin panel
    adminChatId: null,
    ADMIN_CHAT_ID: null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    baseUrl: null,
  };
}

/**
 * Build context for legacy single-bot mode (no migration yet): use env BOT_TOKEN and default tenant.
 */
export function buildLegacyCtx(env) {
  const botId = env.BOT_TOKEN.split(':')[0];
  const prefix = `b:${botId}:`;
  return {
    ...env,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    tenantId: null,
    tenant: null,
    bot: { botId, botToken: env.BOT_TOKEN, webhookSecret: env.WEBHOOK_SECRET },
    TG: `https://api.telegram.org/bot${env.BOT_TOKEN}`,
    prefix,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    adminChatId: env.ADMIN_CHAT_ID || null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    baseUrl: null,
  };
}

/**
 * Check if multi-tenant migration has been run (default tenant + bot exist).
 */
export async function isMigrationDone(kv, botId) {
  if (!kv) return false;
  const tenantId = await getTenantIdByBotId(kv, botId);
  return !!tenantId;
}
