/**
 * @fileoverview Channel resolver for Meta platforms (WhatsApp + Instagram).
 *
 * Resolves tenant from incoming webhook metadata, fetches channel config and token,
 * and builds a channel-scoped ctx ready for handler processing.
 */

import { dbAll } from '../utils/db.js';
import { decryptToken } from '../utils/security.js';
import { buildTenantCtx } from '../tenant/resolver.js';
import { getTenant, getBot, getBotIdsByTenantId, getBotToken } from '../tenant/storage.js';

/**
 * Resolve tenant from a WhatsApp phone_number_id.
 * The phone_number_id is stored in channel_configs.config JSON as { phone_number_id }.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} phoneNumberId
 * @returns {Promise<{tenantId: string, channelConfig: object}|null>}
 */
export async function resolveTenantFromWhatsApp(ctx, phoneNumberId) {
  if (!ctx?.db || !phoneNumberId) return null;
  const rows = await dbAll(ctx,
    "SELECT * FROM channel_configs WHERE channel_type = 'whatsapp' AND active = 1",
  );
  for (const row of rows) {
    try {
      const cfg = row.config ? JSON.parse(row.config) : {};
      if (cfg.phone_number_id === phoneNumberId) {
        return { tenantId: row.tenant_id, channelConfig: row };
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

/**
 * Resolve tenant from an Instagram page ID.
 * The page_id is stored in channel_configs.config JSON as { page_id }.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} igPageId
 * @returns {Promise<{tenantId: string, channelConfig: object}|null>}
 */
export async function resolveTenantFromInstagram(ctx, igPageId) {
  if (!ctx?.db || !igPageId) return null;
  const rows = await dbAll(ctx,
    "SELECT * FROM channel_configs WHERE channel_type = 'instagram' AND active = 1",
  );
  for (const row of rows) {
    try {
      const cfg = row.config ? JSON.parse(row.config) : {};
      if (cfg.page_id === igPageId) {
        return { tenantId: row.tenant_id, channelConfig: row };
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

/**
 * Fetch a channel config for a specific tenant + channel type.
 * Returns the config row with the token decrypted into `token`.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} tenantId
 * @param {'whatsapp'|'instagram'} channelType
 * @param {string|null} encKey - encryption key from env
 * @returns {Promise<object|null>}
 */
export async function getChannelConfig(ctx, tenantId, channelType, encKey = null) {
  if (!ctx?.db) return null;
  const rows = await dbAll(ctx,
    'SELECT * FROM channel_configs WHERE tenant_id = ? AND channel_type = ? AND active = 1 LIMIT 1',
    tenantId, channelType,
  );
  if (!rows.length) return null;
  const row = rows[0];
  const token = row.token_encrypted && encKey
    ? await decryptToken(row.token_encrypted, encKey)
    : null;
  const config = row.config ? JSON.parse(row.config) : {};
  return { ...row, token, config };
}

/**
 * Build a tenant channel context (similar shape to buildTenantCtx) but with the given adapter.
 * The tenant context is drawn from D1; it must already be registered.
 *
 * @param {object} env - Worker env bindings
 * @param {string} tenantId
 * @param {object} channelConfig - Row from channel_configs (with decrypted token)
 * @param {import('./interface.js').ChannelAdapter} channelAdapter - Already-constructed adapter
 * @returns {Promise<object|null>}
 */
export async function buildChannelCtx(env, tenantId, channelConfig, channelAdapter) {
  const ec = { db: env.DB || null, kv: env.MANICBOT, globalKv: env.MANICBOT };
  const tenant = await getTenant(ec, tenantId);
  if (!tenant) return null;

  // Find any bot registered for this tenant (used for billing context etc.)
  const botIds = await getBotIdsByTenantId(ec, tenantId);
  let bot = null;
  let botToken = null;
  if (botIds.length) {
    bot = await getBot(ec, botIds[0]);
    botToken = bot ? await getBotToken(ec, botIds[0], env.BOT_ENCRYPTION_KEY || null) : null;
  }

  const prefix = `t:${tenantId}:`;
  const ctx = {
    ...env,
    kv: env.MANICBOT,
    globalKv: env.MANICBOT,
    db: env.DB || null,
    tenantId,
    tenant,
    bot: bot ? { ...bot, botToken } : null,
    TG: botToken ? `https://api.telegram.org/bot${botToken}` : null,
    prefix,
    ADMIN_KEY: env.ADMIN_KEY,
    WEBHOOK_SECRET: null, // not applicable for Meta webhooks
    adminChatId: env.ADMIN_CHAT_ID || null,
    ADMIN_CHAT_ID: env.ADMIN_CHAT_ID || null,
    AI: env.AI || null,
    WORKERS_AI_API_TOKEN: env.WORKERS_AI_API_TOKEN || null,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID || null,
    baseUrl: null,
    channelConfig, // raw channel_configs row + decrypted token
    channel: channelAdapter,
  };
  return ctx;
}
