/**
 * Resolve tenant and bot from webhook request.
 * Supports: /webhook (legacy, use env BOT_TOKEN) and /webhook/{botId} (from registry).
 */

import { getTenant, getTenantIdByBotId, getBot, getBotToken } from './storage.js';
import { TelegramAdapter } from '../channels/telegram.js';
import { baseCtx } from './baseCtx.js';

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
  const ctx = {
    ...baseCtx(env),
    tenantId,
    tenant,
    bot,
    TG,
    prefix: `t:${tenantId}:`,
    WEBHOOK_SECRET: bot.webhookSecret,
  };
  ctx.channel = new TelegramAdapter(ctx);
  return ctx;
}

/**
 * Build context for legacy single-bot mode.
 */
export function buildLegacyCtx(env) {
  const botId = env.BOT_TOKEN.split(':')[0];
  const ctx = {
    ...baseCtx(env),
    tenantId: null,
    tenant: null,
    bot: { botId, botToken: env.BOT_TOKEN, webhookSecret: env.WEBHOOK_SECRET },
    TG: `https://api.telegram.org/bot${env.BOT_TOKEN}`,
    prefix: `b:${botId}:`,
    WEBHOOK_SECRET: env.WEBHOOK_SECRET,
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
