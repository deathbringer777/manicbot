/**
 * SEO helpers: sitemap.xml + robots.txt generation.
 *
 * Keep URL lists in sync with:
 *   - manicbot/admin-app/src/app/(public)/**            (blog, help, rules, salon, search)
 *   - manicbot/admin-app/src/content/blog/articles.ts   (blog slugs)
 *   - manicbot/src/utils/landing-pages-proxy.js         (legal SPA routes)
 */

import { log } from './logger.js';

export const DEFAULT_SITE_ORIGIN = 'https://manicbot.com';

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
  { slug: 'automate-salon-booking',      lastmod: '2026-04-01' },
  { slug: 'reduce-no-shows',             lastmod: '2026-03-15' },
  { slug: 'nail-trends-2026',            lastmod: '2026-03-01' },
  { slug: 'whatsapp-instagram-channels', lastmod: '2026-02-20' },
  { slug: 'google-calendar-sync',        lastmod: '2026-02-10' },
  { slug: 'first-client-in-10-minutes',  lastmod: '2026-02-01' },
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
  '/blog':     '2026-04-15',
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
      priority: '0.6',
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
 * @param {{ DB?: D1Database | null }} env
 * @param {string} origin Request origin (so it works on preview hosts too).
 */
export async function generateSitemapResponse(env, origin) {
  const base = (origin || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');
  const entries = buildStaticSitemapEntries();

  if (env && env.DB) {
    try {
      const today = todayIso();
      const result = await env.DB
        .prepare('SELECT slug, updated_at FROM tenants WHERE public_active = 1 AND slug IS NOT NULL')
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
 * @param {string} origin Request origin (e.g. https://manicbot.com).
 */
export function renderRobotsTxt(origin = DEFAULT_SITE_ORIGIN) {
  const base = origin.replace(/\/$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    'Allow: /search',
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
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
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
