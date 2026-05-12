/**
 * @fileoverview Channel resolver for Meta platforms (WhatsApp + Instagram).
 *
 * Resolves tenant from incoming webhook metadata, fetches channel config and token,
 * and builds a channel-scoped ctx ready for handler processing.
 */

import { dbAll, dbGet, dbRun } from '../utils/db.js';
import { encryptToken } from '../utils/security.js';
import { decryptToken } from '../utils/security.js';
import { log } from '../utils/logger.js';
import { buildTenantCtx } from '../tenant/resolver.js';
import { baseCtx } from '../tenant/baseCtx.js';
import { getTenant, getBot, getBotIdsByTenantId, getBotToken } from '../tenant/storage.js';

// #S6: must match the label used in token-manager.js so encrypt/decrypt agree.
const CHANNEL_TOKEN_LABEL = 'channel-token-v1';

/** @param {unknown} v */
function channelIdString(v) {
  if (v == null || v === '') return null;
  return String(v);
}

/**
 * Mini App / migrations may store Meta access tokens as plaintext in `token_encrypted`.
 * When BOT_ENCRYPTION_KEY is unset or decrypt fails, still use the value if it looks like a token.
 * @param {string} s
 */
function isLikelyPlaintextMetaChannelToken(s) {
  if (!s || typeof s !== 'string' || s.length < 50) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
  return s.startsWith('EAA') || s.startsWith('IGAA');
}

/**
 * True if webhook `entry.id` matches stored Instagram channel config.
 * Compares string forms of `page_id` and optional `ig_account_id` / `instagram_business_id`.
 *
 * @param {string|number} webhookEntryId - Meta `entry.id` (string or number in JSON)
 * @param {Record<string, unknown>} cfg - Parsed channel_configs.config
 * @returns {boolean}
 */
export function instagramWebhookEntryIdMatchesConfig(webhookEntryId, cfg) {
  const needle = channelIdString(webhookEntryId);
  if (!needle) return false;
  const keys = ['page_id', 'ig_account_id', 'instagram_business_id'];
  for (const k of keys) {
    const cand = channelIdString(cfg[k]);
    if (cand && cand === needle) return true;
  }
  return false;
}

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
  const needle = channelIdString(phoneNumberId);
  if (!needle) return null;
  // #P1-4 — primary path uses the denormalized phone_number_id column with
  // its partial UNIQUE index (migration 0045). Falls back to json_extract for
  // pre-0045 rows that haven't been re-saved through createChannelConfig yet.
  const rows = await dbAll(ctx,
    "SELECT * FROM channel_configs WHERE channel_type = 'whatsapp' AND active = 1 AND phone_number_id = ? LIMIT 1",
    needle,
  );
  if (rows.length) return { tenantId: rows[0].tenant_id, channelConfig: rows[0] };
  // Legacy fallback: json_extract across pre-0045 rows.
  const legacy = await dbAll(ctx,
    "SELECT * FROM channel_configs WHERE channel_type = 'whatsapp' AND active = 1 AND phone_number_id IS NULL AND json_extract(config, '$.phone_number_id') = ? LIMIT 1",
    needle,
  );
  if (legacy.length) return { tenantId: legacy[0].tenant_id, channelConfig: legacy[0] };
  // Final fallback: full scan for type-mismatched JSON values (e.g. number vs string).
  const allRows = await dbAll(ctx,
    "SELECT * FROM channel_configs WHERE channel_type = 'whatsapp' AND active = 1",
  );
  for (const row of allRows) {
    try {
      const cfg = row.config ? JSON.parse(row.config) : {};
      const stored = channelIdString(cfg.phone_number_id);
      if (stored && stored === needle) {
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
  if (!ctx?.db || igPageId == null || igPageId === '') return null;
  const needle = String(igPageId);
  // #P1-4 — primary path uses the denormalized page_id / ig_business_id
  // columns with partial UNIQUE indexes (migration 0045). The Meta entry.id
  // can match either field, so we try both.
  const fast = await dbAll(ctx,
    `SELECT * FROM channel_configs
       WHERE channel_type = 'instagram' AND active = 1
         AND (page_id = ? OR ig_business_id = ?)
       LIMIT 1`,
    needle, needle,
  );
  if (fast.length) return { tenantId: fast[0].tenant_id, channelConfig: fast[0] };
  // Legacy fallback: full scan checking page_id / ig_account_id /
  // instagram_business_id from the JSON config (pre-0045 rows).
  const allRows = await dbAll(ctx,
    "SELECT * FROM channel_configs WHERE channel_type = 'instagram' AND active = 1",
  );
  for (const row of allRows) {
    try {
      const cfg = row.config ? JSON.parse(row.config) : {};
      if (instagramWebhookEntryIdMatchesConfig(igPageId, cfg)) {
        return { tenantId: row.tenant_id, channelConfig: row };
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

/**
 * Resolve tenant from a salon public slug (used by the web chat widget).
 * Unlike WA/IG this does NOT require a row in `channel_configs` — the web
 * channel is a first-party transport and needs no external credentials.
 * Returns a *synthetic* channelConfig so `buildChannelCtx` works unchanged.
 *
 * Only salons with `public_active = 1` are reachable via the web widget so
 * unpublished drafts stay private.
 *
 * @param {{ db: D1Database }} ctx
 * @param {string} slug
 * @returns {Promise<{tenantId: string, channelConfig: object}|null>}
 */
export async function resolveTenantFromSlug(ctx, slug) {
  if (!ctx?.db || !slug || typeof slug !== 'string') return null;
  const rows = await dbAll(
    ctx,
    'SELECT id, name, display_name, logo, cover_photo, brand_palette, slug, public_active FROM tenants WHERE slug = ? AND public_active = 1 LIMIT 1',
    slug,
  );
  if (!rows.length) return null;
  const tenant = rows[0];
  // Synthetic channel config: no row in channel_configs, token=null.
  // Mirrors the shape that `buildChannelCtx` / WebAdapter expect.
  const channelConfig = {
    id: `web:${tenant.id}`,
    tenant_id: tenant.id,
    channel_type: 'web',
    config: { slug },
    token: null,
    active: 1,
  };
  return { tenantId: tenant.id, channelConfig };
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
  let token = null;
  const rawTok = row.token_encrypted;
  if (rawTok) {
    if (!encKey) {
      // P1-8 — fail closed. Returning plaintext from `token_encrypted` when
      // BOT_ENCRYPTION_KEY was unset was a footgun: a forgotten secret
      // caused plaintext tokens to flow outbound. Refuse instead and emit a
      // structured event so ops can fix the deploy.
      log.error('channels.resolver', new Error('channel.token.missing_key'), { tenantId, channelType });
    } else {
      token = await decryptToken(rawTok, encKey, CHANNEL_TOKEN_LABEL);
      if (!token) {
        log.error('channels.resolver', new Error('channel.token.decrypt_failed'), { tenantId, channelType });
      }
    }
  }
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

  // Preview-mode flag (set by `ensurePreviewTenantProvisioned`). When true, the
  // Worker suppresses destructive writes (saveApt, cancelApt) and adds an AI
  // guardrail so the demo stays on-topic. Flag lives in `tenant_config` rather
  // than a dedicated column because it's a platform-internal marker, not
  // tenant-facing configuration.
  let previewMode = false;
  if (ec.db) {
    const row = await dbGet(
      ec,
      "SELECT value FROM tenant_config WHERE tenant_id = ? AND key = 'preview_mode'",
      tenantId,
    ).catch(() => null);
    if (row?.value === '1') previewMode = true;
  }

  const prefix = `t:${tenantId}:`;
  const ctx = {
    ...baseCtx(env),
    tenantId,
    tenant,
    bot: bot ? { ...bot, botToken } : null,
    TG: botToken ? `https://api.telegram.org/bot${botToken}` : null,
    prefix,
    WEBHOOK_SECRET: null, // not applicable for Meta webhooks
    channelConfig, // raw channel_configs row + decrypted token
    channel: channelAdapter,
    previewMode,
  };
  return ctx;
}
