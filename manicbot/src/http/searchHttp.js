import { envCtx } from './envCtx.js';

/**
 * Public search API — no auth required.
 * GET /api/search/autocomplete?q=...
 * Returns JSON: { salons: [{slug,name,city,coverPhoto}], articles: [{slug,title}] }
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
  // Only handle GET /api/search/autocomplete
  if (request.method !== 'GET' || url.pathname !== '/api/search/autocomplete') {
    return null;
  }

  // Rate limit by IP
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const allowed = await checkSearchRateLimit(env.MANICBOT, ip);
  if (!allowed) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: corsHeaders() });
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

  const likeQ = `%${q.toLowerCase()}%`;

  let rows = [];
  try {
    const stmt = ec.db.prepare(
      `SELECT slug, name, city, photos FROM tenants WHERE public_active = 1 AND search_text LIKE ? LIMIT 5`
    ).bind(likeQ);
    const result = await stmt.all();
    rows = result.results || [];
  } catch (e) {
    console.error('[search/autocomplete] D1 error:', e?.message);
  }

  const salons = rows.map((t) => {
    let coverPhoto = null;
    try {
      const photos = t.photos ? JSON.parse(t.photos) : [];
      coverPhoto = photos[0] ?? null;
    } catch { /* ignore */ }
    return { slug: t.slug, name: t.name, city: t.city, coverPhoto };
  });

  // Static blog articles — same list as admin-app tRPC
  const BLOG_ARTICLES = [
    { slug: 'manicbot-telegram-booking', titles: { ru: 'Онлайн-запись через Telegram: как это работает', en: 'Online booking via Telegram: how it works' } },
    { slug: 'ai-beauty-europe-poland', titles: { ru: 'ИИ-ассистент для nail-студий в Европе', en: 'AI assistant for nail studios in Europe' } },
    { slug: 'gel-polish-care-guide', titles: { ru: 'Уход за гель-лаком: советы от мастеров', en: 'Gel polish care guide from nail masters' } },
  ];
  const qLow = q.toLowerCase();
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
