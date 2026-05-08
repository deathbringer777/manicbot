import { envCtx } from './envCtx.js';
import { hasCyrillic, cyrillicToLatin } from '../lib/searchNormalize.js';
import { POPULAR_CITIES } from '../lib/popularCities.js';
import { log } from '../utils/logger.js';

/**
 * Public search API — no auth required.
 * GET /api/search/autocomplete?q=...
 * Returns JSON: { salons: [{slug,name,city,coverPhoto}], articles: [{slug,title}] }
 *
 * GET /api/search/cities
 * Returns JSON: { cities: string[] }
 */
const RATE_LIMIT_WINDOW = 60;  // seconds
const RATE_LIMIT_MAX = 30;     // requests per window per IP

async function checkSearchRateLimit(kv, ip) {
  if (!kv || !ip) return true;
  const key = `rl:search:${ip}`;
  const val = await kv.get(key, 'text');
  const count = val ? parseInt(val, 10) : 0;
  if (count >= RATE_LIMIT_MAX) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

export async function trySearchApi(request, env, url) {
  const isAutocomplete = url.pathname === '/api/search/autocomplete';
  const isCities = url.pathname === '/api/search/cities';

  if (request.method !== 'GET' || (!isAutocomplete && !isCities)) {
    return null;
  }

  // Rate limit by IP
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const allowed = await checkSearchRateLimit(env.MANICBOT, ip);
  if (!allowed) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: corsHeaders() });
  }

  if (!isAutocomplete) {
    // The platform currently operates in Poland only. We deliberately do
    // NOT query the tenants table — legacy / test rows (e.g. "Київ") would
    // pollute the pinned chips and contradict the marketing surface.
    return Response.json({ cities: POPULAR_CITIES }, {
      headers: corsHeaders(),
    });
  }

  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) {
    return Response.json({ salons: [], articles: [] }, {
      headers: corsHeaders(),
    });
  }

  const ec = envCtx(env);
  if (!ec.db) {
    return Response.json({ salons: [], articles: [] }, {
      headers: corsHeaders(),
    });
  }

  const qLow = q.toLowerCase();
  const qLatin = hasCyrillic(q) ? cyrillicToLatin(qLow) : qLow;
  const likeQ = `%${qLow}%`;
  const likeQLatin = `%${qLatin}%`;

  let rows = [];
  try {
    // For Cyrillic queries: also search the transliterated Latin form as a fallback
    const sql = qLatin !== qLow
      ? `SELECT slug, name, city, photos FROM tenants WHERE public_active = 1 AND (search_text LIKE ? OR search_text LIKE ?) LIMIT 5`
      : `SELECT slug, name, city, photos FROM tenants WHERE public_active = 1 AND search_text LIKE ? LIMIT 5`;
    const stmt = qLatin !== qLow
      ? ec.db.prepare(sql).bind(likeQ, likeQLatin)
      : ec.db.prepare(sql).bind(likeQ);
    const result = await stmt.all();
    rows = result.results || [];
  } catch (e) {
    log.error('http.search', e instanceof Error ? e : new Error(String(e?.message)), { action: 'autocomplete' });
  }

  const salons = rows.map((t) => {
    let coverPhoto = null;
    try {
      const photos = t.photos ? JSON.parse(t.photos) : [];
      coverPhoto = photos[0] ?? null;
    } catch { /* ignore */ }
    return { slug: t.slug, name: t.name, city: t.city, coverPhoto };
  });

  // Static blog articles — canonical source: admin-app/src/server/api/routers/publicSalon.ts
  const BLOG_ARTICLES = [
    { slug: 'manicbot-telegram-booking', titles: { ru: 'Онлайн-запись через Telegram: как это работает', en: 'Online booking via Telegram: how it works', ua: 'Онлайн-запис через Telegram: як це працює', pl: 'Rezerwacje online przez Telegram: jak to działa' } },
    { slug: 'ai-beauty-europe-poland', titles: { ru: 'ИИ-ассистент для nail-студий в Европе', en: 'AI assistant for nail studios in Europe', ua: 'ШІ-асистент для нейл-студій у Європі', pl: 'Asystent AI dla studiów paznokci w Europie' } },
    { slug: 'gel-polish-care-guide', titles: { ru: 'Уход за гель-лаком: советы от мастеров', en: 'Gel polish care guide from nail masters', ua: 'Догляд за гель-лаком: поради від майстрів', pl: 'Poradnik pielęgnacji żelowego lakieru' } },
  ];
  const articles = BLOG_ARTICLES
    .filter((a) => Object.values(a.titles).some((title) => title.toLowerCase().includes(qLow)))
    .map((a) => ({ slug: a.slug, title: a.titles.ru || a.titles.en || a.slug }));

  return Response.json({ salons, articles }, {
    headers: corsHeaders(),
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=30',
  };
}
