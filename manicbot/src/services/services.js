import { DEFAULT_SVC, DEFAULT_PHOTOS, DEFAULT_ABOUT_PHOTOS, CORRECTION_SVC, BROKEN_ABOUT_PHOTO_ID, FALLBACK_ABOUT_PHOTO, INSTAGRAM_URL } from '../config.js';
import { L } from '../i18n.js';
import { dbAll, dbRun, dbGet } from '../utils/db.js';

const _svcCacheByTenant = new Map();
const SVC_CACHE_TTL_MS = 60000;

export function buildDefaultSvc() {
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

function svcRowToDoc(row) {
  return {
    id: row.svc_id,
    e: row.emoji,
    dur: row.duration,
    price: row.price,
    active: row.active === 1,
    hidden: row.hidden === 1,
    order: row.sort_order,
    names: row.names ? JSON.parse(row.names) : null,
    desc: row.description ? JSON.parse(row.description) : { ru: null, ua: null, en: null, pl: null },
    photos: row.photos ? JSON.parse(row.photos) : [],
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
    `INSERT OR REPLACE INTO services (tenant_id, svc_id, emoji, duration, price, active, hidden, sort_order, names, description, photos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ctx.tenantId, s.id, s.e || null, s.dur, s.price,
    s.active === false ? 0 : 1,
    s.hidden ? 1 : 0,
    s.order || 0,
    s.names ? JSON.stringify(s.names) : null,
    s.desc ? JSON.stringify(s.desc) : null,
    s.photos ? JSON.stringify(s.photos) : null,
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

async function getConfig(ctx, key) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(ctx, 'SELECT value FROM tenant_config WHERE tenant_id = ? AND key = ?', ctx.tenantId, key);
  if (row?.value != null) {
    try { return JSON.parse(row.value); } catch { return row.value; }
  }
  return null;
}

async function setConfig(ctx, key, value) {
  if (!ctx?.db || !ctx?.tenantId) return;
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await dbRun(ctx,
    'INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)',
    ctx.tenantId, key, v,
  );
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

export function syncSvcNames(ctx) {
  for (const s of ctx.svc) {
    for (const lang of ['ru', 'ua', 'en', 'pl']) {
      if (s.names?.[lang]) L[lang]['svc_' + s.id] = s.names[lang];
    }
  }
}

export async function initServices(ctx) {
  const tid = ctx.tenantId || '';
  const cached = _svcCacheByTenant.get(tid);
  if (cached && (Date.now() - cached.ts) < SVC_CACHE_TTL_MS) {
    ctx.svc = cached.data;
  } else {
    ctx.svc = await loadServices(ctx);
    _svcCacheByTenant.set(tid, { data: ctx.svc, ts: Date.now() });
  }
  ctx.svcIds = new Set(ctx.svc.filter(s => s.active !== false).map(s => s.id));
  if (!ctx.svcIds.has('correction')) ctx.svcIds.add('correction');
  syncSvcNames(ctx);
}

export function invalidateServiceCache(tenantId = null) {
  if (tenantId != null) _svcCacheByTenant.delete(tenantId);
  else _svcCacheByTenant.clear();
}
