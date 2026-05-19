/**
 * SEO helpers: sitemap.xml + robots.txt generation.
 *
 * Keep URL lists in sync with:
 *   - manicbot/admin-app/src/app/(public)/**            (blog, help, rules, salon, search)
 *   - manicbot/admin-app/src/content/blog/articles.ts   (blog slugs)
 *   - manicbot/src/utils/landing-pages-proxy.js         (legal SPA routes)
 */

import { log } from './logger.js';
import { POPULAR_CITIES } from '../lib/popularCities.js';

export const DEFAULT_SITE_ORIGIN = 'https://manicbot.com';

/**
 * URL-slugify a city name. ASCII-fold Polish diacritics so "Wrocław" →
 * "wroclaw" and "Gdańsk" → "gdansk". Lowercase, collapse whitespace,
 * strip leading/trailing dashes. Used by `/salons/{city}` programmatic
 * routes (SEO audit P1-1) and the corresponding sitemap entries.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function citySlug(input) {
  if (input == null || input === '') return '';
  const s = String(input)
    .normalize('NFKD')
    // Strip combining marks (the "ogonek" / acute / dot-above we just split out).
    .replace(/[̀-ͯ]/g, '')
    // Map any remaining non-decomposed Latin special letters.
    .replace(/[łŁ]/g, 'l')
    .replace(/[ąĄ]/g, 'a')
    .replace(/[ęĘ]/g, 'e')
    .replace(/[óÓ]/g, 'o')
    .replace(/[śŚ]/g, 's')
    .replace(/[źżŹŻ]/g, 'z')
    .replace(/[ćĆ]/g, 'c')
    .replace(/[ńŃ]/g, 'n')
    .toLowerCase()
    // Anything non-alphanumeric → dash, collapse runs, trim edges.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s;
}

/**
 * Static routes served by the landing SPA (manicbot-landing.pages.dev proxy).
 * @type {Array<{ loc: string; priority: string; changefreq: string }>}
 */
const LANDING_ROUTES = [
  { loc: '/',         priority: '1.0', changefreq: 'weekly'  },
  { loc: '/privacy',  priority: '0.3', changefreq: 'monthly' },
  { loc: '/terms',    priority: '0.3', changefreq: 'monthly' },
  { loc: '/cookies',  priority: '0.3', changefreq: 'monthly' },
  { loc: '/support',  priority: '0.4', changefreq: 'monthly' },
];

/**
 * Static routes served by the admin-app Next.js Pages (manicbot.com/*).
 * @type {Array<{ loc: string; priority: string; changefreq: string }>}
 */
const ADMIN_APP_PUBLIC_ROUTES = [
  { loc: '/search', priority: '0.9', changefreq: 'daily'   },
  { loc: '/blog',   priority: '0.8', changefreq: 'weekly'  },
  { loc: '/help',   priority: '0.6', changefreq: 'monthly' },
  { loc: '/rules',  priority: '0.3', changefreq: 'yearly'  },
];

/**
 * #P0-4d (relax.md §3) — `/login` and `/register` were previously listed here
 * with priority 0.3, but the rendered pages return `<meta name="robots"
 * content="noindex,nofollow">`. Listing them in the sitemap while marking
 * them noindex sends Google conflicting signals and wastes crawl budget. The
 * decision is to KEEP them noindex (auth flows are thin content with no
 * marketing value) and remove them from the sitemap entirely. The
 * `Disallow: /login` etc. directives in `renderRobotsTxt` below already
 * cover crawl exclusion.
 *
 * If we ever want `/register` to be indexable, we have to (a) drop the
 * noindex from the rendered page, (b) write real marketing copy on it, and
 * (c) re-add it here with a thought-through priority.
 */

/**
 * Blog article slugs — mirrored from admin-app/src/content/blog/articles.ts.
 * We hardcode here because the Worker cannot import from admin-app bundle.
 * Adding a slug here is a one-line change; drift is caught by CI if the test
 * lists the same constant.
 * @type {Array<{ slug: string; lastmod: string }>}
 */
const BLOG_ARTICLES = [
  { slug: 'channels-compared-2026',      lastmod: '2026-05-15' },
  { slug: 'nail-clients-survey-2026',    lastmod: '2026-05-12' },
  { slug: 'ai-receptionist-247',         lastmod: '2026-05-08' },
  { slug: 'dynamic-pricing-salon',       lastmod: '2026-05-01' },
  { slug: 'automate-salon-booking',      lastmod: '2026-05-16' },
  { slug: 'reduce-no-shows',             lastmod: '2026-05-16' },
  { slug: 'nail-trends-2026',            lastmod: '2026-05-16' },
  { slug: 'whatsapp-instagram-channels', lastmod: '2026-05-16' },
  { slug: 'google-calendar-sync',        lastmod: '2026-05-16' },
  { slug: 'first-client-in-10-minutes',  lastmod: '2026-05-16' },
];

/**
 * #P0-4c (relax.md §3) — hardcoded `lastmod` per static route. Previously
 * every entry was stamped with `today` on every sitemap fetch, which Google
 * flags as fake-freshness and uses to discount the entire sitemap. The
 * dates below should be bumped manually when the underlying page content
 * meaningfully changes (not on every deploy). Routes not in this table
 * fall back to `todayIso()` so we don't accidentally emit a missing lastmod.
 *
 * @type {Record<string, string>}
 */
export const ROUTE_LASTMOD = {
  '/':         '2026-04-01',
  '/help':     '2026-03-15',
  '/search':   '2026-05-01',
  '/blog':     '2026-05-16',
  '/privacy':  '2025-12-01',
  '/terms':    '2025-12-01',
  '/cookies':  '2026-04-15',
};

/** XML-escape a URL (only ampersands actually need escaping in `<loc>`). */
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Coerce a DB `updated_at` column to a W3C-DATETIME-compatible YYYY-MM-DD string.
 * Tenants store updated_at as INTEGER epoch seconds (see schema.sql).
 * Accepts: number (epoch seconds/ms), numeric string, ISO string.
 * Returns: YYYY-MM-DD, or null if the input can't be parsed.
 * @param {unknown} value
 * @returns {string | null}
 */
export function coerceLastmodDate(value) {
  if (value == null || value === '') return null;
  // ISO strings that already start with YYYY-MM-DD
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Pure ISO date (YYYY-MM-DD) or ISO datetime — extract date prefix
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    // Numeric string — treat as epoch
    if (/^\d+$/.test(trimmed)) return coerceLastmodDate(Number(trimmed));
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // SQLite strftime('%s') gives epoch *seconds*. JS Date wants milliseconds.
    // Anything below year 2900 in seconds (~3e10) → treat as seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Build the list of sitemap entries (excluding DB-driven salon slugs).
 * Pure function — no env, no I/O. Easy to unit test.
 *
 * #P0-4c — per-route lastmod is sourced from `ROUTE_LASTMOD` so the
 * sitemap reports honest freshness instead of stamping `today` everywhere.
 * The `today` argument remains as a safety net for routes that aren't in
 * the table; we'd rather emit a too-fresh date than a missing one.
 *
 * @param {string} [today]
 */
export function buildStaticSitemapEntries(today = todayIso()) {
  const resolveLastmod = (loc) => ROUTE_LASTMOD[loc] || today;
  const withLastmod = (entries) =>
    entries.map((e) => ({ ...e, lastmod: resolveLastmod(e.loc) }));
  return [
    ...withLastmod(LANDING_ROUTES),
    ...withLastmod(ADMIN_APP_PUBLIC_ROUTES),
    // AUTH_PUBLIC_ROUTES removed (see comment above) — keeps auth pages out
    // of the sitemap; the matching Disallow directives stay in robots.txt.
    ...BLOG_ARTICLES.map((a) => ({
      loc: `/blog/${a.slug}`,
      // Long-form, indexable content with image — bump up from the previous
      // 0.6 placeholder so Google treats blog detail pages closer to landing.
      priority: '0.7',
      changefreq: 'monthly',
      lastmod: a.lastmod,
    })),
  ];
}

/**
 * Render sitemap entries as XML.
 * @param {Array<{ loc: string; priority: string; changefreq: string; lastmod?: string }>} entries
 * @param {string} base Origin without trailing slash, e.g. https://manicbot.com
 */
export function renderSitemapXml(entries, base = DEFAULT_SITE_ORIGIN) {
  const origin = base.replace(/\/$/, '');
  const body = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${xmlEscape(origin + e.loc)}</loc>${
          e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''
        }\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * Build a complete sitemap response — static entries + DB-driven salon slugs.
 *
 * SEO audit 2026-05-20 P0-3 + P1-10: the SELECT now filters `is_test = 0`
 * so the 16 test / demo accounts that previously dominated the production
 * sitemap stop reaching Googlebot. Real-customer salons (publicActive=1
 * AND isTest=0) are emitted with `lastmod` derived from `updated_at`.
 *
 * SEO audit 2026-05-20 P1-1: programmatic city directory pages
 * (`/salons/{slug}`) are surfaced for every POPULAR_CITIES entry — this is
 * how Google discovers the new content-SEO route class.
 *
 * @param {{ DB?: D1Database | null }} env
 * @param {string} origin Request origin (so it works on preview hosts too).
 */
export async function generateSitemapResponse(env, origin) {
  const base = (origin || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');
  const entries = buildStaticSitemapEntries();
  const today = todayIso();

  // P1-1: programmatic city directory pages.
  for (const city of POPULAR_CITIES) {
    const slug = citySlug(city);
    if (!slug) continue;
    entries.push({
      loc: `/salons/${slug}`,
      priority: '0.8',
      changefreq: 'weekly',
      lastmod: today,
    });
  }

  if (env && env.DB) {
    try {
      // P0-3 + P1-10: filter out test accounts.
      const result = await env.DB
        .prepare('SELECT slug, updated_at FROM tenants WHERE public_active = 1 AND is_test = 0 AND slug IS NOT NULL')
        .all();
      for (const row of result.results || []) {
        if (!row.slug) continue;
        entries.push({
          loc: `/salon/${row.slug}`,
          priority: '0.7',
          changefreq: 'weekly',
          lastmod: coerceLastmodDate(row.updated_at) || today,
        });
      }
    } catch (err) {
      log.warn('utils.seo', { message: 'sitemap: failed to load salon slugs', error: err?.message || String(err) });
    }
  }

  const xml = renderSitemapXml(entries, base);
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/**
 * Render robots.txt. Public pages allowed; all internal/API/auth paths blocked.
 *
 * SEO audit 2026-05-20 P2-5: explicit allow blocks for the major AI bots
 * (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, CCBot). Today's
 * `User-agent: *` default already allows everything; the explicit blocks
 * are paper trail and make our AI visibility intent legible to the
 * operators of those crawlers.
 *
 * @param {string} origin Request origin (e.g. https://manicbot.com).
 */
export function renderRobotsTxt(origin = DEFAULT_SITE_ORIGIN) {
  const base = origin.replace(/\/$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    'Allow: /search',
    'Allow: /salons/',
    'Allow: /blog',
    'Allow: /help',
    'Allow: /rules',
    'Allow: /salon/',
    '',
    '# Private / internal',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /webhook',
    'Disallow: /webhook/',
    'Disallow: /stripe/',
    'Disallow: /google/',
    'Disallow: /calendar/',
    'Disallow: /tg',
    'Disallow: /tg/',
    'Disallow: /dashboard',
    'Disallow: /appointments',
    'Disallow: /tenants',
    'Disallow: /users',
    'Disallow: /conversations',
    'Disallow: /platform-support',
    'Disallow: /settings',
    'Disallow: /system',
    'Disallow: /events',
    'Disallow: /agents',
    'Disallow: /billing',
    'Disallow: /stripe',
    '',
    '# Auth flows — keep out of index (thin content, duplicate titles)',
    'Disallow: /login',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /verify-email',
    'Disallow: /confirm-email-change',
    '',
    '# AI bots — explicit allow (P2-5). Mirrors the `*` default but makes',
    '# our AI-visibility intent legible to operators of each crawler.',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    'User-agent: Google-Extended',
    'Allow: /',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    '',
    'User-agent: CCBot',
    'Allow: /',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Render `/llms.txt` per <https://llmstxt.org/>. Static markdown that LLM
 * crawlers consume for a one-page overview of the site. Goes alongside
 * sitemap.xml + robots.txt as a third "machine-readable site index" file.
 *
 * SEO audit 2026-05-20 P1-7.
 *
 * @param {string} origin
 */
export function renderLlmsTxt(origin = DEFAULT_SITE_ORIGIN) {
  const base = origin.replace(/\/$/, '');
  return [
    '# ManicBot',
    '',
    '> AI booking platform for nail salons. Online booking via web widget, Telegram, Instagram, and WhatsApp — 24/7, in Russian, Polish, English and Ukrainian. Pricing from 45 PLN/month with 0% commission. Operating in Poland and Europe.',
    '',
    '## About',
    '',
    'ManicBot is a multi-tenant booking SaaS for nail salons and independent nail masters. Salons connect their existing channels (Telegram, Instagram DM, WhatsApp, web chat) and the AI receptionist handles the entire booking flow — slot selection, service catalog, master selection, confirmation, reminders — without human intervention.',
    '',
    'Supported languages: Russian (ru), Polish (pl), English (en), Ukrainian (uk).',
    '',
    'Pricing (PLN/month):',
    '- Start — 45 PLN/mo — 1 master',
    '- Pro — 60 PLN/mo — 5 masters, AI assistant, Google Calendar sync',
    '- Max — 90 PLN/mo — unlimited masters, white label, all features',
    '',
    'No per-booking commission. 14-day free trial. Billed monthly via Stripe.',
    '',
    '## Key URLs',
    '',
    `- [Salon directory](${base}/search) — browse all public salons by city/service`,
    `- [Blog](${base}/blog) — guides on running a nail salon, AI receptionist, automation, channel strategy`,
    `- [Help center](${base}/help) — product documentation`,
    `- [Rules](${base}/rules) — terms of service, acceptable use`,
    `- [Sitemap](${base}/sitemap.xml) — full list of indexable URLs`,
    '',
    '## City directories',
    '',
    ...POPULAR_CITIES.map((c) => `- [Nail salons in ${c}](${base}/salons/${citySlug(c)})`),
    '',
    '## Programmatic surfaces',
    '',
    `- Salon profiles: ${base}/salon/{slug}`,
    `- City directory pages: ${base}/salons/{city-slug}`,
    `- Blog articles: ${base}/blog/{slug}`,
    '',
    '## Channels',
    '',
    'Each salon can connect any combination of: Telegram bot, Instagram Direct, WhatsApp Business, and an embeddable web chat widget. The same AI receptionist serves every channel with a unified conversation history.',
    '',
    '## Contact',
    '',
    `- Telegram: https://t.me/manicbot_com`,
    `- Website: ${base}`,
    '',
  ].join('\n');
}

/**
 * Build the `/llms.txt` HTTP response.
 *
 * @param {string} origin
 */
export function generateLlmsTxtResponse(origin) {
  return new Response(renderLlmsTxt(origin), {
    status: 200,
    headers: {
      // text/markdown is correct per RFC 7763 but many older parsers expect
      // text/plain; Cloudflare's CDN handles both — pick markdown because
      // that's what the llmstxt.org spec recommends.
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}

/**
 * Build robots.txt response.
 * @param {string} origin
 */
export function generateRobotsResponse(origin) {
  return new Response(renderRobotsTxt(origin), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
