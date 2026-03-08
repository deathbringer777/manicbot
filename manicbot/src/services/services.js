import { DEFAULT_SVC, DEFAULT_PHOTOS, DEFAULT_ABOUT_PHOTOS, CORRECTION_SVC, BROKEN_ABOUT_PHOTO_ID, FALLBACK_ABOUT_PHOTO, INSTAGRAM_URL } from '../config.js';
import { L } from '../i18n.js';
import { kvGet, kvPut } from '../utils/kv.js';

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

export async function loadServices(ctx) {
  let services = await kvGet(ctx, 'cfg:svc_list');
  if (!services || !Array.isArray(services) || services.length === 0) {
    services = buildDefaultSvc();
    await kvPut(ctx, 'cfg:svc_list', services);
  }
  if (!services.some(s => s.id === 'correction')) {
    services = [...services, CORRECTION_SVC];
    await kvPut(ctx, 'cfg:svc_list', services);
  }
  return services;
}

export async function saveServices(ctx, services) {
  if (!services.some(s => s.id === 'correction')) {
    services = [...services, CORRECTION_SVC];
  }
  ctx.svc = services;
  ctx.svcIds = new Set(services.filter(s => s.active !== false).map(s => s.id));
  if (!ctx.svcIds.has('correction')) ctx.svcIds.add('correction');
  await kvPut(ctx, 'cfg:svc_list', services);
  syncSvcNames(ctx);
  invalidateServiceCache();
}

export async function loadAboutPhotos(ctx) {
  let stored = await kvGet(ctx, 'cfg:about_photos');
  if (stored && Array.isArray(stored) && stored.length > 0) {
    const fixed = stored.map(u => (u && u.includes(BROKEN_ABOUT_PHOTO_ID)) ? FALLBACK_ABOUT_PHOTO : u);
    if (fixed.some((u, i) => u !== stored[i])) {
      await kvPut(ctx, 'cfg:about_photos', fixed);
      return fixed;
    }
    return stored;
  }
  await kvPut(ctx, 'cfg:about_photos', DEFAULT_ABOUT_PHOTOS);
  return DEFAULT_ABOUT_PHOTOS;
}

export async function saveAboutPhotos(ctx, photos) {
  await kvPut(ctx, 'cfg:about_photos', photos);
}

export async function loadAboutDesc(ctx) {
  const stored = await kvGet(ctx, 'cfg:about_desc');
  return stored != null && String(stored).trim() ? stored : null;
}

export async function saveAboutDesc(ctx, desc) {
  const v = String(desc || '').trim();
  await kvPut(ctx, 'cfg:about_desc', v || null);
}

export async function loadInstagramUrl(ctx) {
  const stored = await kvGet(ctx, 'cfg:instagram_url');
  return stored != null && String(stored).trim() ? stored : INSTAGRAM_URL;
}

export async function saveInstagramUrl(ctx, url) {
  const v = String(url || '').trim();
  await kvPut(ctx, 'cfg:instagram_url', v || null);
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
