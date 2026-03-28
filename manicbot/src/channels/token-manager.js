/**
 * @fileoverview Channel token management — encrypt, decrypt, and refresh access tokens.
 *
 * Wraps the low-level crypto functions from security.js for the multi-channel use-case.
 * All tokens in channel_configs are AES-GCM encrypted at rest.
 */

import { encryptToken, decryptToken, randomId } from '../utils/security.js';
import { dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';

/**
 * Encrypt a plaintext token and store (or update) it in channel_configs.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} channelConfigId - PK of the channel_configs row
 * @param {string} plainToken
 * @param {string|null} encKey - BOT_ENCRYPTION_KEY
 * @param {number|null} [expiresAt] - Unix seconds when token expires (optional)
 * @returns {Promise<boolean>} true on success
 */
export async function encryptAndStoreToken(ctx, channelConfigId, plainToken, encKey, expiresAt = null) {
  if (!ctx?.db) return false;
  const encrypted = encKey ? await encryptToken(plainToken, encKey) : plainToken;
  if (!encrypted) return false;
  await dbRun(ctx,
    'UPDATE channel_configs SET token_encrypted = ?, token_expires_at = ?, updated_at = ? WHERE id = ?',
    encrypted, expiresAt, nowSec(), channelConfigId,
  );
  return true;
}

/**
 * Fetch and decrypt a token from channel_configs.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} channelConfigId
 * @param {string|null} encKey
 * @returns {Promise<string|null>}
 */
export async function getDecryptedToken(ctx, channelConfigId, encKey) {
  if (!ctx?.db) return null;
  const rows = await dbAll(ctx, 'SELECT token_encrypted FROM channel_configs WHERE id = ? LIMIT 1', channelConfigId);
  if (!rows.length || !rows[0].token_encrypted) return null;
  return encKey ? await decryptToken(rows[0].token_encrypted, encKey) : rows[0].token_encrypted;
}

/**
 * Check if an Instagram long-lived token is expiring soon.
 * Instagram tokens are valid for 60 days; we refresh if < daysThreshold remain.
 *
 * @param {object} channelConfig - Row from channel_configs
 * @param {number} [daysThreshold=10]
 * @returns {boolean}
 */
export function isTokenExpiring(channelConfig, daysThreshold = 10) {
  if (!channelConfig?.token_expires_at) return false;
  const threshold = nowSec() + daysThreshold * 86400;
  return channelConfig.token_expires_at < threshold;
}

/**
 * Refresh an Instagram long-lived user access token.
 * Uses GET graph.facebook.com/refresh_access_token
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} channelConfigId
 * @param {string|null} encKey
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function refreshInstagramToken(ctx, channelConfigId, encKey) {
  const currentToken = await getDecryptedToken(ctx, channelConfigId, encKey);
  if (!currentToken) return { ok: false, error: 'no_token' };

  try {
    const url = new URL('https://graph.facebook.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', currentToken);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!data.access_token) {
      return { ok: false, error: data.error?.message ?? 'no_token_in_response' };
    }

    const expiresIn = data.expires_in ?? 5184000; // default 60 days
    const expiresAt = nowSec() + expiresIn;
    const stored = await encryptAndStoreToken(ctx, channelConfigId, data.access_token, encKey, expiresAt);
    return stored ? { ok: true } : { ok: false, error: 'store_failed' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Create a new channel_configs row.
 * Returns the newly-created ID.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} tenantId
 * @param {'whatsapp'|'instagram'} channelType
 * @param {object} config - Channel-specific config object (will be JSON-stringified)
 * @param {string} plainToken
 * @param {string|null} encKey
 * @param {string|null} [webhookVerifyToken]
 * @returns {Promise<string|null>} ID of the created row, or null on failure
 */
export async function createChannelConfig(ctx, tenantId, channelType, config, plainToken, encKey, webhookVerifyToken = null) {
  if (!ctx?.db) return null;
  const id = randomId(12);
  const encrypted = encKey ? await encryptToken(plainToken, encKey) : plainToken;
  const now = nowSec();

  await dbRun(ctx,
    `INSERT OR REPLACE INTO channel_configs
      (id, tenant_id, channel_type, config, token_encrypted, webhook_verify_token, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, tenantId, channelType,
    JSON.stringify(config),
    encrypted,
    webhookVerifyToken,
    now, now,
  );
  return id;
}
