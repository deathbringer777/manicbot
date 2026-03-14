/**
 * Tenant and bot registry storage. All keys are GLOBAL (no tenant prefix).
 * - tenant:{tenantId} → tenant document
 * - bot:{botId} → bot document (token stored encrypted when BOT_ENCRYPTION_KEY set)
 * - botmap:{botId} → tenantId (string, for fast lookup)
 */

import { encryptToken, decryptToken } from '../utils/security.js';
import { SALON, ADDRESS, PHONE, MAPS_URL, INSTAGRAM_URL, WORK, DEFAULT_SVC, DEFAULT_PHOTOS, DEFAULT_ABOUT_PHOTOS } from '../config.js';

const TENANT_PREFIX = 'tenant:';
const BOT_PREFIX = 'bot:';
const BOTMAP_PREFIX = 'botmap:';
const TENANTS_INDEX_KEY = 'tenants_index';
const BOTS_INDEX_PREFIX = 'botsindex:';

// ── Index helpers (strong-consistency replacements for kv.list()) ─────────────

async function getTenantIndex(kv) {
  try {
    const raw = await kv.get(TENANTS_INDEX_KEY, 'json');
    return Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

async function addTenantToIndex(kv, tenantId) {
  try {
    const index = (await getTenantIndex(kv)) || [];
    if (!index.includes(tenantId)) {
      index.push(tenantId);
      await kv.put(TENANTS_INDEX_KEY, JSON.stringify(index));
    }
  } catch (e) { console.error('addTenantToIndex:', e.message); }
}

async function getBotIndex(kv, tenantId) {
  try {
    const raw = await kv.get(BOTS_INDEX_PREFIX + tenantId, 'json');
    return Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

async function addBotToIndex(kv, tenantId, botId) {
  try {
    const index = (await getBotIndex(kv, tenantId)) || [];
    if (!index.includes(botId)) {
      index.push(botId);
      await kv.put(BOTS_INDEX_PREFIX + tenantId, JSON.stringify(index));
    }
  } catch (e) { console.error('addBotToIndex:', e.message); }
}

function tenantKey(tenantId) {
  return TENANT_PREFIX + tenantId;
}

function botKey(botId) {
  return BOT_PREFIX + botId;
}

function botmapKey(botId) {
  return BOTMAP_PREFIX + botId;
}

export async function getTenant(kv, tenantId) {
  if (!kv || !tenantId) return null;
  try {
    const raw = await kv.get(tenantKey(tenantId), 'json');
    return raw;
  } catch {
    return null;
  }
}

export async function putTenant(kv, tenantId, data) {
  if (!kv || !tenantId) return false;
  try {
    await kv.put(tenantKey(tenantId), JSON.stringify(data));
    await addTenantToIndex(kv, tenantId);
    return true;
  } catch (e) {
    console.error('putTenant:', e.message);
    return false;
  }
}

export async function getBot(kv, botId) {
  if (!kv || !botId) return null;
  try {
    const raw = await kv.get(botKey(botId), 'json');
    return raw;
  } catch {
    return null;
  }
}

export async function getTenantIdByBotId(kv, botId) {
  if (!kv || !botId) return null;
  try {
    const tenantId = await kv.get(botmapKey(botId), 'text');
    return tenantId;
  } catch {
    return null;
  }
}

export async function putBot(kv, botId, data, encryptionKey = null) {
  if (!kv || !botId) return false;
  try {
    const payload = { ...data };
    if (payload.botToken && encryptionKey) {
      payload.encryptedToken = await encryptToken(payload.botToken, encryptionKey);
      delete payload.botToken;
    }
    await kv.put(botKey(botId), JSON.stringify(payload));
    const tenantIdToMap = payload.tenantId || data.tenantId;
    try {
      await kv.put(botmapKey(botId), tenantIdToMap);
    } catch (e) {
      console.error('putBot: botmap write failed, retrying:', e.message);
      await kv.put(botmapKey(botId), tenantIdToMap);
    }
    if (tenantIdToMap) await addBotToIndex(kv, tenantIdToMap, botId);
    return true;
  } catch (e) {
    console.error('putBot:', e.message);
    return false;
  }
}

export async function getBotToken(kv, botId, encryptionKey = null) {
  const bot = await getBot(kv, botId);
  if (!bot) return null;
  if (bot.botToken) return bot.botToken;
  if (bot.encryptedToken && encryptionKey) {
    return await decryptToken(bot.encryptedToken, encryptionKey);
  }
  return null;
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
    plan: 'free',
    billingStatus: 'active',
    subscriptionStatus: null,
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

export async function listTenantIds(kv) {
  // Use index key for strong consistency (kv.list has eventual consistency)
  const index = await getTenantIndex(kv);
  if (index !== null) return index;

  // First call after deploy: index doesn't exist yet — fall back to kv.list()
  // and persist the index so future calls skip this slow path.
  const keys = [];
  let cursor;
  do {
    const res = await kv.list({ prefix: TENANT_PREFIX, cursor });
    for (const k of res.keys) {
      const id = k.name.slice(TENANT_PREFIX.length);
      if (id) keys.push(id);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  try { await kv.put(TENANTS_INDEX_KEY, JSON.stringify(keys)); } catch (_) {}
  return keys;
}

/** Return botIds that are bound to this tenantId. */
export async function getBotIdsByTenantId(kv, tenantId) {
  if (!kv || !tenantId) return [];

  // Use per-tenant bot index for strong consistency
  const index = await getBotIndex(kv, tenantId);
  if (index !== null) return index;

  // First call: fall back to kv.list() and persist the index
  const out = [];
  let cursor;
  do {
    const res = await kv.list({ prefix: BOT_PREFIX, cursor });
    for (const k of res.keys) {
      const botId = k.name.slice(BOT_PREFIX.length);
      const tenantIdFromMap = await getTenantIdByBotId(kv, botId);
      if (tenantIdFromMap === tenantId) out.push(botId);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  try { await kv.put(BOTS_INDEX_PREFIX + tenantId, JSON.stringify(out)); } catch (_) {}
  return out;
}
