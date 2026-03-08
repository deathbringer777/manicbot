// ══════════════════════════════════════════════════════════════
// Bot registry and bot-to-tenant binding
// Tokens are never stored in KV; use tokenRef e.g. "env:BOT_TOKEN"
// ══════════════════════════════════════════════════════════════

import { DEFAULT_TENANT_ID } from './tenant.js';
import { bindingByBotKey, botKey } from './keys.js';

/**
 * Resolve bot and tenant from request (single-bot backward compat).
 * If env has BOT_TOKEN, returns { botId: 'default', tenantId: 'default', token }.
 * For multi-bot: use /webhook/:botId and look up binding in KV.
 * @param {Request} request
 * @param {Object} env - env.BOT_TOKEN, env.MANICBOT (KV)
 * @returns {{ botId: string, tenantId: string, token: string } | null}
 */
export function resolveBotAndTenant(request, env) {
  const token = env.BOT_TOKEN;
  if (!token) return null;
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // /webhook or /webhook/:botId
  if (pathParts[0] === 'webhook' && pathParts.length === 1) {
    return {
      botId: 'default',
      tenantId: DEFAULT_TENANT_ID,
      token,
    };
  }
  if (pathParts[0] === 'webhook' && pathParts.length === 2) {
    const botId = pathParts[1];
    // Multi-bot: binding stored in KV binding:bot:{botId} -> { tenantId }; token from env BOT_TOKEN_{botId} or secrets
    const tokenRef = env[`BOT_TOKEN_${botId}`] || env.BOT_TOKEN;
    if (!tokenRef) return null;
    return {
      botId,
      tenantId: null, // will be loaded from KV in getBindingForBot
      token: tokenRef,
    };
  }
  return null;
}

/**
 * Get tenantId for a bot from KV binding. For 'default' bot returns DEFAULT_TENANT_ID without KV.
 * @param {KVNamespace} kv
 * @param {string} botId
 * @returns {Promise<string|null>}
 */
export async function getTenantIdForBot(kv, botId) {
  if (botId === 'default') return DEFAULT_TENANT_ID;
  if (!kv) return null;
  try {
    const b = await kv.get(bindingByBotKey(botId), 'json');
    return b?.tenantId ?? null;
  } catch {
    return null;
  }
}

/**
 * Save bot-to-tenant binding. (Platform admin use.)
 * @param {KVNamespace} kv
 * @param {string} botId
 * @param {string} tenantId
 */
export async function setBinding(kv, botId, tenantId) {
  if (!kv) return;
  try {
    await kv.put(
      bindingByBotKey(botId),
      JSON.stringify({ botId, tenantId, status: 'active', createdAt: Date.now() })
    );
  } catch (e) {
    console.error('setBinding fail:', e?.message);
  }
}

/**
 * Bot record (for registry). Token never stored in KV.
 */
export function createBotRecord(overrides = {}) {
  return {
    botId: overrides.botId ?? '',
    telegramBotId: overrides.telegramBotId ?? null,
    botUsername: overrides.botUsername ?? null,
    tokenRef: overrides.tokenRef ?? null, // e.g. "env:BOT_TOKEN"
    status: overrides.status ?? 'active',
    webhookConfigured: overrides.webhookConfigured ?? false,
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  };
}
