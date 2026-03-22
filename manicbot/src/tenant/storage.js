/**
 * Tenant and bot registry storage — D1 backed.
 * - tenants table → tenant documents
 * - bots table → bot metadata (token stays in KV encrypted)
 * - KV bottoken:{botId} → encrypted bot token (stays for security)
 */

import { encryptToken, decryptToken } from '../utils/security.js';
import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { SALON, ADDRESS, PHONE, MAPS_URL, INSTAGRAM_URL, WORK, DEFAULT_SVC, DEFAULT_PHOTOS, DEFAULT_ABOUT_PHOTOS } from '../config.js';

const BOT_TOKEN_PREFIX = 'bottoken:';

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
    created_at: data.createdAt || Date.now(),
    updated_at: data.updatedAt || Date.now(),
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
      `INSERT OR REPLACE INTO tenants (id, name, active, salon, photos, about_photos, maps_url, instagram_url, plan, billing_status, subscription_status, trial_ends_at, grace_ends_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, next_payment_date, billing_email, cancel_at_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, p.name, p.active, p.salon, p.photos, p.about_photos, p.maps_url, p.instagram_url,
      p.plan, p.billing_status, p.subscription_status, p.trial_ends_at, p.grace_ends_at,
      p.stripe_customer_id, p.stripe_subscription_id, p.stripe_price_id,
      p.current_period_end, p.next_payment_date, p.billing_email, p.cancel_at_period_end,
      p.created_at, p.updated_at,
    );
    return true;
  } catch (e) {
    console.error('putTenant:', e.message);
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
    const kv = ctx.kv || ctx.globalKv;
    if (data.botToken && kv) {
      if (encryptionKey) {
        const encrypted = await encryptToken(data.botToken, encryptionKey);
        await kv.put(BOT_TOKEN_PREFIX + botId, encrypted);
      } else {
        await kv.put(BOT_TOKEN_PREFIX + botId, data.botToken);
      }
    }
    await dbRun(ctx,
      `INSERT OR REPLACE INTO bots (bot_id, tenant_id, bot_username, webhook_secret, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      botId,
      data.tenantId || null,
      data.botUsername || null,
      data.webhookSecret || '',
      data.active === false ? 0 : 1,
      data.createdAt || Date.now(),
      data.updatedAt || Date.now(),
    );
    return true;
  } catch (e) {
    console.error('putBot:', e.message);
    return false;
  }
}

export async function getBotToken(ctx, botId, encryptionKey = null) {
  if (!botId) return null;
  const kv = ctx?.kv || ctx?.globalKv;
  if (!kv) return null;
  try {
    const raw = await kv.get(BOT_TOKEN_PREFIX + botId, 'text');
    if (!raw) return null;
    if (encryptionKey && raw.includes(':')) {
      return await decryptToken(raw, encryptionKey);
    }
    return raw;
  } catch {
    return null;
  }
}

export function defaultTenantPayload(botId, env) {
  const salonName = env.SALON_NAME || SALON;
  const address = env.ADDRESS || ADDRESS;
  const phone = env.PHONE || PHONE;
  return {
    id: 'default',
    name: salonName,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export async function listTenantIds(ctx) {
  if (!ctx?.db) return [];
  const rows = await dbAll(ctx, 'SELECT id FROM tenants');
  return rows.map(r => r.id);
}

export async function getBotIdsByTenantId(ctx, tenantId) {
  if (!ctx?.db || !tenantId) return [];
  const rows = await dbAll(ctx, 'SELECT bot_id FROM bots WHERE tenant_id = ?', tenantId);
  return rows.map(r => r.bot_id);
}
