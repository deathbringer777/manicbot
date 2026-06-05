/**
 * Tenant and bot registry storage — D1 backed.
 * - tenants table → tenant documents
 * - bots table → bot metadata + token_encrypted (AES-GCM, label bot-token-v1)
 *
 * Bot tokens migrated from KV to D1 on 2026-05-08. KV binding removed.
 */

import { encryptToken, decryptToken, decryptTokenWithFallback } from '../utils/security.js';
import { log } from '../utils/logger.js';
import { logEvent } from '../utils/events.js';

// #S6: HKDF subkey label for Telegram bot tokens stored in D1.
// Distinct from 'channel-token-v1' (D1 channel_configs) so a leaked label
// derivation in one storage tier doesn't compromise the other.
const BOT_TOKEN_LABEL = 'bot-token-v1';
import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { SALON, ADDRESS, PHONE, MAPS_URL, INSTAGRAM_URL, WORK, DEFAULT_SVC, DEFAULT_PHOTOS, DEFAULT_ABOUT_PHOTOS } from '../config.js';

function tenantRowToDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    active: row.active === 1,
    salon: row.salon ? JSON.parse(row.salon) : null,
    photos: row.photos ? JSON.parse(row.photos) : null,
    aboutPhotos: row.about_photos ? JSON.parse(row.about_photos) : null,
    mapsUrl: row.maps_url,
    instagramUrl: row.instagram_url,
    plan: row.plan,
    billingStatus: row.billing_status,
    subscriptionStatus: row.subscription_status,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    currentPeriodEnd: row.current_period_end,
    nextPaymentDate: row.next_payment_date,
    billingEmail: row.billing_email,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    logo: row.logo || null,
    coverPhoto: row.cover_photo || null,
    slug: row.slug || null,
    description: row.description || null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    city: row.city || null,
    publicActive: row.public_active === 1,
    chatEnabled: row.chat_enabled === undefined ? true : row.chat_enabled === 1,
    searchText: row.search_text || null,
    parentTenantId: row.parent_tenant_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function docToTenantParams(data) {
  return {
    id: data.id,
    name: data.name,
    active: data.active === false ? 0 : 1,
    salon: data.salon ? JSON.stringify(data.salon) : null,
    photos: data.photos ? JSON.stringify(data.photos) : null,
    about_photos: data.aboutPhotos ? JSON.stringify(data.aboutPhotos) : null,
    maps_url: data.mapsUrl || null,
    instagram_url: data.instagramUrl || null,
    plan: data.plan || 'start',
    billing_status: data.billingStatus || 'trialing',
    subscription_status: data.subscriptionStatus || null,
    trial_ends_at: data.trialEndsAt || null,
    grace_ends_at: data.graceEndsAt || null,
    stripe_customer_id: data.stripeCustomerId || null,
    stripe_subscription_id: data.stripeSubscriptionId || null,
    stripe_price_id: data.stripePriceId || null,
    current_period_end: data.currentPeriodEnd || null,
    next_payment_date: data.nextPaymentDate || null,
    billing_email: data.billingEmail || null,
    cancel_at_period_end: data.cancelAtPeriodEnd ? 1 : 0,
    logo: data.logo || null,
    cover_photo: data.coverPhoto || null,
    slug: data.slug || null,
    description: data.description || null,
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    city: data.city || null,
    public_active: data.publicActive ? 1 : 0,
    // 0091 — chat surface independence flag. Default ON for new tenants so
    // the chat URL works the moment a slug is set; callers that want a
    // paused chat must pass `chatEnabled: false` explicitly.
    chat_enabled: data.chatEnabled === false ? 0 : 1,
    search_text: data.searchText || null,
    // 0109 — preserve secondary-salon parent across billing writes (putTenant
    // is INSERT-OR-REPLACE; an omitted column would reset to NULL).
    parent_tenant_id: data.parentTenantId || null,
    created_at: data.createdAt || nowSec(),
    updated_at: data.updatedAt || nowSec(),
  };
}

export async function getTenant(ctx, tenantId) {
  if (!ctx?.db || !tenantId) return null;
  const row = await dbGet(ctx, 'SELECT * FROM tenants WHERE id = ?', tenantId);
  return tenantRowToDoc(row);
}

export async function putTenant(ctx, tenantId, data) {
  if (!ctx?.db || !tenantId) return false;
  try {
    const p = docToTenantParams({ ...data, id: tenantId });
    await dbRun(ctx,
      `INSERT OR REPLACE INTO tenants (id, name, active, salon, photos, about_photos, maps_url, instagram_url, plan, billing_status, subscription_status, trial_ends_at, grace_ends_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, next_payment_date, billing_email, cancel_at_period_end, logo, cover_photo, slug, description, lat, lng, city, public_active, chat_enabled, search_text, parent_tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, p.name, p.active, p.salon, p.photos, p.about_photos, p.maps_url, p.instagram_url,
      p.plan, p.billing_status, p.subscription_status, p.trial_ends_at, p.grace_ends_at,
      p.stripe_customer_id, p.stripe_subscription_id, p.stripe_price_id,
      p.current_period_end, p.next_payment_date, p.billing_email, p.cancel_at_period_end,
      p.logo, p.cover_photo, p.slug, p.description, p.lat, p.lng, p.city, p.public_active, p.chat_enabled, p.search_text,
      p.parent_tenant_id,
      p.created_at, p.updated_at,
    );
    return true;
  } catch (e) {
    log.error('tenant.storage', e instanceof Error ? e : new Error(String(e.message)), { action: 'putTenant' });
    return false;
  }
}

export async function getBot(ctx, botId) {
  if (!ctx?.db || !botId) return null;
  const row = await dbGet(ctx, 'SELECT * FROM bots WHERE bot_id = ?', botId);
  if (!row) return null;
  return {
    botId: row.bot_id,
    tenantId: row.tenant_id,
    botUsername: row.bot_username,
    webhookSecret: row.webhook_secret,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTenantIdByBotId(ctx, botId) {
  if (!ctx?.db || !botId) return null;
  const row = await dbGet(ctx, 'SELECT tenant_id FROM bots WHERE bot_id = ?', botId);
  return row?.tenant_id || null;
}

export async function putBot(ctx, botId, data, encryptionKey = null) {
  if (!ctx?.db || !botId) return false;
  try {
    let tokenEncrypted = null;
    if (data.botToken) {
      if (!encryptionKey) {
        // No encryption key configured — refuse to store tokens in plaintext.
        log.error('tenant.storage', new Error('BOT_ENCRYPTION_KEY not set — refusing to store plaintext bot token'), { botId });
        return false;
      }
      const encrypted = await encryptToken(data.botToken, encryptionKey, BOT_TOKEN_LABEL);
      if (!encrypted) {
        log.error('tenant.storage', new Error('putBot encryption failed — refusing to store plaintext bot token'), { botId });
        return false;
      }
      tokenEncrypted = encrypted;
    }
    await dbRun(ctx,
      `INSERT OR REPLACE INTO bots (bot_id, tenant_id, bot_username, webhook_secret, active, token_encrypted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      botId,
      data.tenantId || null,
      data.botUsername || null,
      data.webhookSecret || '',
      data.active === false ? 0 : 1,
      tokenEncrypted,
      data.createdAt || nowSec(),
      data.updatedAt || nowSec(),
    );
    return true;
  } catch (e) {
    log.error('tenant.storage', e instanceof Error ? e : new Error(String(e.message)), { action: 'putBot' });
    return false;
  }
}

/**
 * Resolve a bot's plaintext Telegram token from D1.
 *
 * Failure modes (each emits log.error + a `bot.token.*` event so silent breakage
 * is impossible — this regressed once already, see test/bot-token-failure-modes.test.js):
 *   - bot row missing                          → null  (no event, normal for unknown bots)
 *   - token_encrypted column NULL              → null  + event `bot.token.missing`
 *   - encrypted blob (no ':') with no key set  → null  + event `bot.token.key_missing`
 *   - encrypted blob fails to decrypt          → null  + event `bot.token.decrypt_failed`
 *   - blob decrypts only with old key (rotation) → plaintext, event `bot.token.used_old_key`
 *
 * Why the old-key fallback: an in-flight BOT_ENCRYPTION_KEY rotation must not
 * dark-screen prod. Set `ctx.BOT_ENCRYPTION_KEY_OLD` (mirror of the secret) and
 * decryptTokenWithFallback transparently retries with the previous key.
 */
export async function getBotToken(ctx, botId, encryptionKey = null) {
  if (!botId) return null;
  if (!ctx?.db) return null;
  let row;
  try {
    // tenant-scan-ignore: bot->token resolver keyed by globally-unique bot_id (inbound webhook path; bot_id is the tenant discriminator).
    row = await dbGet(ctx, 'SELECT token_encrypted FROM bots WHERE bot_id = ?', botId);
  } catch (e) {
    log.error('tenant.storage', e instanceof Error ? e : new Error(String(e?.message ?? e)), { action: 'getBotToken_dbGet', botId });
    return null;
  }
  if (!row) return null; // bot row missing — not a token issue, caller will return null
  if (!row.token_encrypted) {
    log.error('tenant.storage', new Error('getBotToken: token_encrypted is NULL'), { botId, reason: 'token_missing' });
    void logEvent(ctx, 'bot.token.missing', { level: 'error', botId, message: `Bot ${botId} has no token_encrypted in D1 — re-onboard or run /admin/migrate-bot-tokens` });
    return null;
  }
  const raw = row.token_encrypted;
  // Plaintext Telegram tokens are formatted `botId:secret` and always contain ':'.
  // Encrypted blobs are base64 (legacy) or `v1$<base64>` (HKDF) — neither contains ':'.
  if (raw.includes(':')) return raw;

  // From here, blob is encrypted. We MUST have a usable key, otherwise refuse —
  // returning the blob as a "token" produced the old prod silence (Telegram URL
  // became `bot<base64>` → 401 → no reply → ✓✓ delivered with no answer).
  if (!encryptionKey || String(encryptionKey).length < 32) {
    log.error('tenant.storage', new Error('getBotToken: encrypted blob present but no usable BOT_ENCRYPTION_KEY'), { botId, reason: 'encryption_key_missing' });
    void logEvent(ctx, 'bot.token.key_missing', { level: 'error', botId, message: `Bot ${botId} has encrypted token but BOT_ENCRYPTION_KEY is unset/short` });
    return null;
  }

  const oldKey = ctx?.BOT_ENCRYPTION_KEY_OLD || null;
  let result;
  try {
    result = await decryptTokenWithFallback(raw, encryptionKey, oldKey, BOT_TOKEN_LABEL);
  } catch (e) {
    log.error('tenant.storage', e instanceof Error ? e : new Error(String(e?.message ?? e)), { action: 'getBotToken_decrypt', botId });
    void logEvent(ctx, 'bot.token.decrypt_failed', { level: 'error', botId, message: `Decrypt threw for bot ${botId}: ${e?.message ?? 'unknown'}` });
    return null;
  }
  if (result.plain == null) {
    log.error('tenant.storage', new Error('getBotToken: decrypt returned null (wrong key, label mismatch, or corrupt blob)'), { botId, reason: 'decrypt_failed' });
    void logEvent(ctx, 'bot.token.decrypt_failed', { level: 'error', botId, message: `Decrypt failed for bot ${botId} — check BOT_ENCRYPTION_KEY rotation status` });
    return null;
  }
  if (result.usedOldKey) {
    log.warn('tenant.storage', { message: 'getBotToken decrypted with BOT_ENCRYPTION_KEY_OLD — schedule re-encrypt via /admin/rotate-encryption-key', botId });
    void logEvent(ctx, 'bot.token.used_old_key', { level: 'warn', botId, message: `Bot ${botId} token decrypted via old key — re-encrypt pending` });
  }
  return result.plain;
}

export function defaultTenantPayload(botId, env) {
  const salonName = env.SALON_NAME || SALON;
  const address = env.ADDRESS || ADDRESS;
  const phone = env.PHONE || PHONE;
  return {
    id: 'default',
    name: salonName,
    active: true,
    createdAt: nowSec(),
    updatedAt: nowSec(),
    salon: {
      name: salonName,
      address,
      phone,
      timezone: 'Europe/Warsaw',
      workHours: WORK,
      currency: 'PLN',
    },
    services: DEFAULT_SVC,
    photos: DEFAULT_PHOTOS,
    aboutPhotos: DEFAULT_ABOUT_PHOTOS,
    mapsUrl: MAPS_URL,
    instagramUrl: INSTAGRAM_URL,
    plan: 'start',
    billingStatus: 'trialing',
    subscriptionStatus: null,
    trialEndsAt: null,
    graceEndsAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    billingEmail: null,
    cancelAtPeriodEnd: false,
  };
}

export function defaultBotPayload(botId, tenantId, botToken, webhookSecret, botUsername = null) {
  return {
    botId,
    tenantId,
    botToken,
    botUsername: botUsername || `bot_${botId}`,
    webhookSecret,
    active: true,
    createdAt: nowSec(),
    updatedAt: nowSec(),
  };
}

export async function listTenantIds(ctx) {
  if (!ctx?.db) return [];
  // Filter to active tenants only — inactive ones must not receive cron queue
  // messages (wastes queue quota and triggers unnecessary Worker invocations).
  const rows = await dbAll(ctx, 'SELECT id FROM tenants WHERE active = 1');
  return rows.map(r => r.id);
}

export async function getBotIdsByTenantId(ctx, tenantId) {
  if (!ctx?.db || !tenantId) return [];
  const rows = await dbAll(ctx, 'SELECT bot_id FROM bots WHERE tenant_id = ?', tenantId);
  return rows.map(r => r.bot_id);
}
