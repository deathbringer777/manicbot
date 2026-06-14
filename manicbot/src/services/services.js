import { DEFAULT_SVC, DEFAULT_PHOTOS, DEFAULT_ABOUT_PHOTOS, CORRECTION_SVC, BROKEN_ABOUT_PHOTO_ID, FALLBACK_ABOUT_PHOTO, INSTAGRAM_URL } from '../config.js';
import { L } from '../i18n.js';
import { dbAll, dbRun, dbGet } from '../utils/db.js';

const _svcCacheByTenant = new Map();
const SVC_CACHE_TTL_MS = 60000;
const SVC_CACHE_MAX_SIZE = 200;

function buildDefaultSvc() {
  return DEFAULT_SVC.map((s, i) => ({
    id: s.id, e: s.e, dur: s.dur, price: s.price, active: true, order: i,
    names: {
      ru: L.ru['svc_' + s.id] || s.id,
      ua: L.ua['svc_' + s.id] || s.id,
      en: L.en['svc_' + s.id] || s.id,
      pl: L.pl['svc_' + s.id] || s.id,
    },
    desc: { ru: null, ua: null, en: null, pl: null },
    photos: DEFAULT_PHOTOS[s.id] || [],
  }));
}

function safeParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function svcRowToDoc(row) {
  return {
    id: row.svc_id,
    e: row.emoji,
    dur: row.duration,
    price: row.price,
    active: row.active === 1,
    hidden: row.hidden === 1,
    order: row.sort_order,
    names: safeParse(row.names, null),
    desc: safeParse(row.description, { ru: null, ua: null, en: null, pl: null }),
    photos: safeParse(row.photos, []),
    category: row.category ?? null,
  };
}

export async function loadServices(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return [...buildDefaultSvc(), CORRECTION_SVC];

  const rows = await dbAll(ctx, 'SELECT * FROM services WHERE tenant_id = ? ORDER BY sort_order', ctx.tenantId);
  if (rows.length > 0) {
    let services = rows.map(svcRowToDoc);
    if (!services.some(s => s.id === 'correction')) {
      services = [...services, CORRECTION_SVC];
      await saveServiceRow(ctx, CORRECTION_SVC);
    }
    return services;
  }
  const defaults = buildDefaultSvc();
  const all = [...defaults, CORRECTION_SVC];
  for (const s of all) await saveServiceRow(ctx, s);
  return all;
}

async function saveServiceRow(ctx, s) {
  await dbRun(ctx,
    `INSERT OR REPLACE INTO services (tenant_id, svc_id, emoji, duration, price, active, hidden, sort_order, names, description, photos, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ctx.tenantId, s.id, s.e || null, s.dur, s.price,
    s.active === false ? 0 : 1,
    s.hidden ? 1 : 0,
    s.order || 0,
    s.names ? JSON.stringify(s.names) : null,
    s.desc ? JSON.stringify(s.desc) : null,
    s.photos ? JSON.stringify(s.photos) : null,
    s.category ?? null,
  );
}

export async function saveServices(ctx, services) {
  if (!services.some(s => s.id === 'correction')) {
    services = [...services, CORRECTION_SVC];
  }
  ctx.svc = services;
  ctx.svcIds = new Set(services.filter(s => s.active !== false).map(s => s.id));
  if (!ctx.svcIds.has('correction')) ctx.svcIds.add('correction');

  if (ctx?.db && ctx?.tenantId) {
    await dbRun(ctx, 'DELETE FROM services WHERE tenant_id = ?', ctx.tenantId);
    for (const s of services) await saveServiceRow(ctx, s);
  }
  syncSvcNames(ctx);
  invalidateServiceCache();
}

// ── About photos & desc → tenant_config ─────────────────────────────────────

export async function getConfig(ctx, key) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(ctx, 'SELECT value FROM tenant_config WHERE tenant_id = ? AND key = ?', ctx.tenantId, key);
  if (row?.value != null) {
    try { return JSON.parse(row.value); } catch { return row.value; }
  }
  return null;
}

export async function setConfig(ctx, key, value) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await dbRun(ctx,
    'INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)',
    ctx.tenantId, key, v,
  );
}

// ── Per-channel auto-confirm settings ───────────────────────────────────────

/**
 * Per-channel auto-confirm. Web defaults to ON because the salon owner is
 * not glued to the web widget — bookings from TikTok/Instagram bio links
 * should land as confirmed without manual review. Telegram / WhatsApp /
 * Instagram default to OFF (current behaviour) because masters are
 * already in the loop on those channels.
 *
 * Stored in `tenant_config` under keys `auto_confirm_{channel}`.
 *
 * @param {string} channel - 'web' | 'telegram' | 'whatsapp' | 'instagram'
 */
const AUTO_CONFIRM_DEFAULTS = {
  web: true,
  telegram: false,
  whatsapp: false,
  instagram: false,
};

export async function getAutoConfirm(ctx, channel) {
  const key = `auto_confirm_${channel || 'telegram'}`;
  const stored = await getConfig(ctx, key);
  if (stored == null) return AUTO_CONFIRM_DEFAULTS[channel] === true;
  // Stored as JSON boolean or stringified boolean
  if (typeof stored === 'boolean') return stored;
  if (typeof stored === 'string') return stored === 'true' || stored === '1';
  if (typeof stored === 'number') return stored !== 0;
  return AUTO_CONFIRM_DEFAULTS[channel] === true;
}

export async function setAutoConfirm(ctx, channel, enabled) {
  const key = `auto_confirm_${channel || 'telegram'}`;
  await setConfig(ctx, key, enabled === true);
}

/**
 * 0074 — "Auto-suggest favorite master" per channel. Mirrors the
 * AUTO_CONFIRM_DEFAULTS / getAutoConfirm pair. Both channels default
 * ON because the suggestion is purely additive (client can still pick
 * a different master from the keyboard / Select). Source-of-truth for
 * defaults lives here AND in admin-app `salon.getAutoSuggestFavoriteSettings`
 * — keep them in lockstep.
 */
const FAVORITE_SUGGEST_DEFAULTS = {
  web: true,
  telegram: true,
};

export async function getFavoriteSuggest(ctx, channel) {
  const key = `fav_suggest_${channel || 'telegram'}`;
  const stored = await getConfig(ctx, key);
  if (stored == null) return FAVORITE_SUGGEST_DEFAULTS[channel] === true;
  if (typeof stored === 'boolean') return stored;
  if (typeof stored === 'string') return stored === 'true' || stored === '1';
  if (typeof stored === 'number') return stored !== 0;
  return FAVORITE_SUGGEST_DEFAULTS[channel] === true;
}

export async function setFavoriteSuggest(ctx, channel, enabled) {
  const key = `fav_suggest_${channel || 'telegram'}`;
  await setConfig(ctx, key, enabled === true);
}

// ── Featured service for the web-chat welcome card ───────────────────────────

/**
 * Warm-up gate: only auto-promote the "most popular" service once it has at
 * least this many real bookings. Below it we keep the predictable default (the
 * first service) so a single stray booking can't hijack the welcome card.
 */
export const MIN_BOOKINGS_FOR_FEATURED = 5;

/** Active, non-hidden services that have at least one photo, in display order. */
function featurableServices(ctx) {
  return (ctx.svc || []).filter(
    s => s.active !== false && s.hidden !== true && Array.isArray(s.photos) && s.photos.length > 0,
  );
}

/**
 * Most-booked featurable service for the tenant (all time). Counted in JS rather
 * than SQL GROUP BY — the Worker test mock-db parser doesn't support GROUP BY,
 * and salons are small so the projected `svc_id` column is cheap. Only real
 * (non-cancelled, non-no-show) appointments count.
 * @returns {Promise<{ svcId: string, count: number }|null>}
 */
async function topBookedFeaturableService(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const featurable = new Set(featurableServices(ctx).map(s => s.id));
  if (!featurable.size) return null;
  const rows = await dbAll(ctx,
    'SELECT svc_id FROM appointments WHERE tenant_id = ? AND cancelled = 0 AND no_show = 0',
    ctx.tenantId);
  const counts = new Map();
  for (const r of rows) {
    if (!featurable.has(r.svc_id)) continue;
    counts.set(r.svc_id, (counts.get(r.svc_id) || 0) + 1);
  }
  let best = null;
  for (const [svcId, count] of counts) {
    if (!best || count > best.count) best = { svcId, count };
  }
  return best;
}

/**
 * Resolve which service to showcase under the web-chat welcome message.
 * Priority: (1) the salon's manual pin (`featured_service_id`, unless 'auto'),
 * (2) the most-booked service once it clears MIN_BOOKINGS_FOR_FEATURED,
 * (3) the first active service with photos. Returns null when no service has
 * photos (caller then skips the card). Resilient: any DB error falls back to (3).
 * @returns {Promise<string|null>}
 */
export async function resolveFeaturedServiceId(ctx) {
  const featurable = featurableServices(ctx);
  if (!featurable.length) return null;
  const firstId = featurable[0].id;

  // 1) Manual pin always wins (when it still points at a valid service).
  try {
    const pinned = await getConfig(ctx, 'featured_service_id');
    if (pinned && pinned !== 'auto' && featurable.some(s => s.id === pinned)) return pinned;
  } catch { /* fall through to auto */ }

  // 2) Most popular, gated by the warm-up threshold.
  try {
    const top = await topBookedFeaturableService(ctx);
    if (top && top.count >= MIN_BOOKINGS_FOR_FEATURED) return top.svcId;
  } catch { /* fall through to default */ }

  // 3) Default: the first service with photos.
  return firstId;
}

export async function loadAboutPhotos(ctx) {
  let stored = await getConfig(ctx, 'about_photos');
  if (stored && Array.isArray(stored) && stored.length > 0) {
    const fixed = stored.map(u => (u && u.includes(BROKEN_ABOUT_PHOTO_ID)) ? FALLBACK_ABOUT_PHOTO : u);
    if (fixed.some((u, i) => u !== stored[i])) {
      await setConfig(ctx, 'about_photos', fixed);
      return fixed;
    }
    return stored;
  }
  await setConfig(ctx, 'about_photos', DEFAULT_ABOUT_PHOTOS);
  return DEFAULT_ABOUT_PHOTOS;
}

export async function saveAboutPhotos(ctx, photos) {
  await setConfig(ctx, 'about_photos', photos);
}

export async function loadAboutDesc(ctx) {
  const stored = await getConfig(ctx, 'about_desc');
  return stored != null && String(stored).trim() ? stored : null;
}

export async function saveAboutDesc(ctx, desc) {
  const v = String(desc || '').trim();
  await setConfig(ctx, 'about_desc', v || null);
}

export async function loadInstagramUrl(ctx) {
  const stored = await getConfig(ctx, 'instagram_url');
  return stored != null && String(stored).trim() ? stored : INSTAGRAM_URL;
}

export async function saveInstagramUrl(ctx, url) {
  const v = String(url || '').trim();
  await setConfig(ctx, 'instagram_url', v || null);
}

function syncSvcNames(ctx) {
  if (!ctx.svc) return;
  for (const s of ctx.svc) {
    for (const lang of ['ru', 'ua', 'en', 'pl']) {
      if (s.names?.[lang]) L[lang]['svc_' + s.id] = s.names[lang];
    }
  }
}

/**
 * Read the service_categories list for this tenant. Returns rows ordered by
 * sort_order (then by name as a stable tiebreaker). The Worker keyboard
 * builder uses this ordering to group services in the Telegram catalog.
 *
 * Returns [] when there's no DB or no rows — the keyboard falls back to a
 * flat list in that case (legacy behavior).
 */
export async function loadServiceCategories(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return [];
  return dbAll(
    ctx,
    'SELECT id, name, sort_order FROM service_categories WHERE tenant_id = ? ORDER BY sort_order, name',
    ctx.tenantId,
  );
}

export async function initServices(ctx) {
  const tid = ctx.tenantId || '';
  const cached = _svcCacheByTenant.get(tid);
  if (cached && (Date.now() - cached.ts) < SVC_CACHE_TTL_MS) {
    ctx.svc = cached.data;
    ctx.svcCategories = cached.categories || [];
  } else {
    ctx.svc = await loadServices(ctx);
    ctx.svcCategories = await loadServiceCategories(ctx);
    if (_svcCacheByTenant.size >= SVC_CACHE_MAX_SIZE) {
      const oldest = [..._svcCacheByTenant.entries()].sort((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < Math.floor(SVC_CACHE_MAX_SIZE / 4); i++) _svcCacheByTenant.delete(oldest[i][0]);
    }
    _svcCacheByTenant.set(tid, { data: ctx.svc, categories: ctx.svcCategories, ts: Date.now() });
  }
  ctx.svcIds = new Set(ctx.svc.filter(s => s.active !== false).map(s => s.id));
  if (!ctx.svcIds.has('correction')) ctx.svcIds.add('correction');
  syncSvcNames(ctx);
}

function invalidateServiceCache(tenantId = null) {
  if (tenantId != null) _svcCacheByTenant.delete(tenantId);
  else _svcCacheByTenant.clear();
}
