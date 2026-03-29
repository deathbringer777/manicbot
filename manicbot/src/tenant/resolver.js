/**
 * Resolve tenant and bot from webhook request.
 * Supports: /webhook (legacy, use env BOT_TOKEN) and /webhook/{botId} (from registry).
 */

import { getTenant, getTenantIdByBotId, getBot, getBotToken } from './storage.js';
import { TelegramAdapter } from '../channels/telegram.js';

const DEFAULT_TENANT_ID = 'default';

/**
 * Resolve tenant from bot ID (from D1 registry).
 * @param {{ db: D1Database, kv: KVNamespace }} ctx
 * @param {string} botId
 * @param {string} [encryptionKey]
 */
export async function resolveTenantFromBotId(ctx, botId, encryptionKey = null) {
  if (!ctx?.db || !botId) return null;
  const tenantId = await getTenantIdByBotId(ctx, botId);
  if (!tenantId) return null;
  const [tenant, bot] = await Promise.all([getTenant(ctx, tenantId), getBot(ctx, botId)]);
  if (!tenant || !bot || !bot.active) return null;
  const token = await getBotToken(ctx, botId, encryptionKey);
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
 */
export function buildTenantCtx(env, resolved) {
  const { tenantId, tenant, bot, TG } = resolved;
  const prefix = `t:${tenantId}:`;
  const ctx = {
    ...env,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    db: env.DB || null,
    tenantId,
    tenant,
    bot,
    TG,
    prefix,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: bot.webhookSecret,
    adminChatId: env.ADMIN_CHAT_ID || null,
    ADMIN_CHAT_ID: env.ADMIN_CHAT_ID || null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    BOT_ENCRYPTION_KEY: env.BOT_ENCRYPTION_KEY || null,
    GOOGLE_SERVICE_ACCOUNT_KEY: env.GOOGLE_SERVICE_ACCOUNT_KEY || null,
    GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID || null,
    GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET || null,
    GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI || null,
    GOOGLE_TOKEN_ENCRYPTION_KEY: env.GOOGLE_TOKEN_ENCRYPTION_KEY || null,
    APP_BASE_URL: env.APP_BASE_URL || null,
    baseUrl: null,
    ADMIN_APP_URL: env.ADMIN_APP_URL || null,
  };
  ctx.channel = new TelegramAdapter(ctx);
  return ctx;
}

/**
 * Build context for legacy single-bot mode.
 */
export function buildLegacyCtx(env) {
  const botId = env.BOT_TOKEN.split(':')[0];
  const prefix = `b:${botId}:`;
  const ctx = {
    ...env,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    db: env.DB || null,
    tenantId: null,
    tenant: null,
    bot: { botId, botToken: env.BOT_TOKEN, webhookSecret: env.WEBHOOK_SECRET },
    TG: `https://api.telegram.org/bot${env.BOT_TOKEN}`,
    prefix,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
    adminChatId: env.ADMIN_CHAT_ID || null,
    ADMIN_CHAT_ID: env.ADMIN_CHAT_ID || null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    BOT_ENCRYPTION_KEY: env.BOT_ENCRYPTION_KEY || null,
    GOOGLE_SERVICE_ACCOUNT_KEY: env.GOOGLE_SERVICE_ACCOUNT_KEY || null,
    GOOGLE_OAUTH_CLIENT_ID: env.GOOGLE_OAUTH_CLIENT_ID || null,
    GOOGLE_OAUTH_CLIENT_SECRET: env.GOOGLE_OAUTH_CLIENT_SECRET || null,
    GOOGLE_OAUTH_REDIRECT_URI: env.GOOGLE_OAUTH_REDIRECT_URI || null,
    GOOGLE_TOKEN_ENCRYPTION_KEY: env.GOOGLE_TOKEN_ENCRYPTION_KEY || null,
    APP_BASE_URL: env.APP_BASE_URL || null,
    baseUrl: null,
    ADMIN_APP_URL: env.ADMIN_APP_URL || null,
  };
  ctx.channel = new TelegramAdapter(ctx);
  return ctx;
}

/**
 * Check if multi-tenant migration has been run (bot exists in D1).
 */
export async function isMigrationDone(ctx, botId) {
  if (!ctx?.db) return false;
  const tenantId = await getTenantIdByBotId(ctx, botId);
  return !!tenantId;
}
