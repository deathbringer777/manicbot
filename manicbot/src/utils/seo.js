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
  { loc: '/search',      priority: '0.9', changefreq: 'daily'   },
  { loc: '/blog',        priority: '0.8', changefreq: 'weekly'  },
  { loc: '/pricing',     priority: '0.9', changefreq: 'monthly' },
  { loc: '/about',       priority: '0.7', changefreq: 'monthly' },
  { loc: '/comparisons', priority: '0.8', changefreq: 'monthly' },
  // Individual comparison pages — added inline so the data file stays the
  // single source of truth for available competitors.
  { loc: '/comparisons/manicbot-vs-booksy',   priority: '0.7', changefreq: 'monthly' },
  { loc: '/comparisons/manicbot-vs-fresha',   priority: '0.7', changefreq: 'monthly' },
  { loc: '/comparisons/manicbot-vs-yclients', priority: '0.7', changefreq: 'monthly' },
  { loc: '/comparisons/manicbot-vs-versum',   priority: '0.7', changefreq: 'monthly' },
  { loc: '/help',        priority: '0.6', changefreq: 'monthly' },
  { loc: '/rules',       priority: '0.3', changefreq: 'yearly'  },
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
  { slug: 'instagram-bookings-2026',     lastmod: '2026-06-01' },
  { slug: 'tiktok-for-nail-salons',      lastmod: '2026-05-30' },
  { slug: 'local-seo-nail-salon',        lastmod: '2026-05-29' },
  { slug: 'salon-reviews-reputation',    lastmod: '2026-05-28' },
  { slug: 'nail-salon-pricing-guide',    lastmod: '2026-05-27' },
  { slug: 'client-retention-loyalty',    lastmod: '2026-05-26' },
  { slug: 'scale-solo-to-team',          lastmod: '2026-05-23' },
  { slug: 'seasonal-marketing-calendar', lastmod: '2026-05-22' },
  { slug: 'ai-beauty-trends-2026',       lastmod: '2026-05-21' },
  { slug: 'booking-conversion',          lastmod: '2026-05-19' },
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
  '/':            '2026-04-01',
  '/help':        '2026-03-15',
  '/search':      '2026-05-01',
  '/blog':        '2026-05-16',
  '/pricing':     '2026-05-20',
  '/about':       '2026-05-20',
  '/comparisons': '2026-05-20',
  '/comparisons/manicbot-vs-booksy':   '2026-05-20',
  '/comparisons/manicbot-vs-fresha':   '2026-05-20',
  '/comparisons/manicbot-vs-yclients': '2026-05-20',
  '/comparisons/manicbot-vs-versum':   '2026-05-20',
  '/privacy':     '2025-12-01',
  '/terms':       '2025-12-01',
  '/cookies':     '2026-04-15',
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
 * SEO audit 2026-05-20 P0-4: when `opts.headOnly` is true (HEAD method) we
 * MUST NOT touch D1. Bing/Meta crawlers + uptime monitors probe HEAD before
 * GET; a D1 round-trip on every HEAD probe would burn budget and create a
 * cross-tenant query on what should be a constant-time probe.
 *
 * @param {{ DB?: D1Database | null }} env
 * @param {string} origin Request origin (so it works on preview hosts too).
 * @param {{ headOnly?: boolean }} [opts]
 */
export async function generateSitemapResponse(env, origin, opts = {}) {
  const base = (origin || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');

  // HEAD short-circuit: empty body, same headers, no D1 read.
  if (opts.headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

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
        const lastmod = coerceLastmodDate(row.updated_at) || today;
        entries.push({
          loc: `/salon/${row.slug}`,
          priority: '0.7',
          changefreq: 'weekly',
          lastmod,
        });
        // SEO audit 2026-05-20 P1-7: surface the AI-chat URL too —
        // it's a high-conversion landing target for Instagram bio links,
        // TikTok bio, QR codes printed in the salon. Lower priority than
        // the salon profile (0.7 vs 0.6) so Google still treats the
        // profile as canonical.
        entries.push({
          loc: `/salon/${row.slug}/chat`,
          priority: '0.6',
          changefreq: 'weekly',
          lastmod,
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
    '# Auth flows (/login, /register, /forgot-password, /reset-password,',
    '# /verify-email, /confirm-email-change) carry a `noindex` meta tag via',
    '# admin-app (auth)/layout.tsx, so they are intentionally NOT Disallow-ed:',
    '# a robots.txt block would hide the noindex from Googlebot and cause',
    "# \"Indexed, though blocked by robots.txt\" (observed on /login, 2026-06).",
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
 * Top guides emitted in the llms.txt ## Top guides section.
 * Keep slugs in sync with manicbot/admin-app/src/content/blog/articles.ts
 * (the same list driving the sitemap blog entries above).
 *
 * Summaries are one factual sentence each — LLMs cite concise prose more
 * reliably than marketing copy. English so the same llms.txt works for
 * EN-language LLM crawlers without locale negotiation.
 *
 * @type {Array<{ slug: string; title: string; summary: string }>}
 */
const LLMS_TOP_GUIDES = [
  { slug: 'instagram-bookings-2026',     title: 'Instagram for nail salons: DMs, Stories and Reels into bookings',     summary: 'How nail salons turn Instagram into a booking channel — Reels for reach (+35% followers/month), saveable carousels, link-in-bio, comment-to-DM automation, and 5-minute DM replies.' },
  { slug: 'tiktok-for-nail-salons',      title: 'TikTok for nail salons: viral views into booked appointments',        summary: 'A TikTok playbook for nail salons — short-form process and before/after formats, trending audio, and converting roughly 3x-faster follower growth into bookings via a profile link.' },
  { slug: 'local-seo-nail-salon',        title: 'Local SEO for nail salons: rank for "nail salon near me"',             summary: 'How nail salons rank in Google local search — a complete Google Business Profile, reviews, photos, NAP consistency, and a realistic 3-6 month timeline.' },
  { slug: 'salon-reviews-reputation',    title: 'More 5-star reviews on autopilot for nail salons',                    summary: 'A system for collecting more 5-star reviews and handling negative ones — review-request timing (77% leave one if asked), response templates, and cross-platform monitoring.' },
  { slug: 'nail-salon-pricing-guide',    title: 'Nail salon pricing and menu engineering',                            summary: 'How to structure a tiered nail-service menu and raise prices without losing clients — markup math, a premium anchor, and a 30-day price-increase playbook.' },
  { slug: 'client-retention-loyalty',    title: 'Retention and loyalty: rebook 69% like the top salons',               summary: 'Retention tactics that lift rebooking toward the 69% top-salon benchmark — checkout pre-booking, 90-day win-back, and digital loyalty over paper punch cards.' },
  { slug: 'scale-solo-to-team',          title: 'From a solo nail master to a team',                                   summary: 'How a solo nail master scales to a team — a live speed-test interview, booth-rent vs commission models, and the systems that keep a multi-chair salon profitable.' },
  { slug: 'seasonal-marketing-calendar', title: 'The 2026 nail-salon marketing calendar',                             summary: 'A month-by-month marketing calendar for nail salons — seasonal demand peaks, gift-card promotions (sales up about 93% YoY), and campaigns that fill slow weeks.' },
  { slug: 'ai-beauty-trends-2026',       title: 'AI in beauty 2026: what nail salons are automating',                  summary: 'How AI is used in nail and beauty salons in 2026 — booking chatbots, predictive no-show scoring, and deposits that cut no-shows from 15-30% to under 5%.' },
  { slug: 'booking-conversion',          title: 'Why clients abandon booking and how to recover them',                 summary: 'Where nail-salon bookings leak — slow replies, hidden prices, app-install friction — and the fixes that recover would-be clients: 5-minute replies and in-messenger booking.' },
  { slug: 'channels-compared-2026',      title: 'Booking channels compared: Telegram vs Instagram vs WhatsApp vs web', summary: 'Which channel converts best for nail salons in 2026, with conversion-rate data and per-platform constraints.' },
  { slug: 'ai-receptionist-247',         title: 'AI receptionist that books appointments 24/7',                          summary: 'How a multilingual AI receptionist handles the entire booking flow without staff intervention.' },
  { slug: 'reduce-no-shows',             title: 'Reduce no-shows: deposits, reminders, follow-ups',                      summary: 'Concrete tactics nail salons use to push no-show rates below 5%, with reminder timing recipes.' },
  { slug: 'automate-salon-booking',      title: 'Automate salon booking end-to-end',                                     summary: 'Step-by-step playbook for replacing manual DM bookings with a fully automated receptionist.' },
  { slug: 'whatsapp-instagram-channels', title: 'WhatsApp Business + Instagram Direct for salon bookings',               summary: 'How to connect WhatsApp Business API and Instagram DM as booking channels, with template best practices.' },
  { slug: 'google-calendar-sync',        title: 'Two-way Google Calendar sync',                                          summary: 'Setting up Google Calendar two-way sync so busy blocks and private events never collide with client bookings.' },
  { slug: 'first-client-in-10-minutes',  title: 'First client booked in 10 minutes',                                     summary: 'Onboarding checklist that gets a new salon from sign-up to first paying client in under 10 minutes.' },
  { slug: 'dynamic-pricing-salon',       title: 'Dynamic pricing for nail services',                                     summary: 'When and how to vary nail-service prices by master, day-of-week, and demand — with conversion data.' },
  { slug: 'nail-trends-2026',            title: 'Nail trends 2026',                                                       summary: 'The trends nail salons should add to their service menu in 2026, with price and duration guidance.' },
  { slug: 'nail-clients-survey-2026',    title: 'What nail clients actually want (2026 survey)',                          summary: 'Survey results from 2,000+ nail clients on booking channel preferences, reminder frequency, and deposit tolerance.' },
];

/**
 * Comparison pages emitted in llms.txt ## Comparisons. The pages live at
 * /comparisons/manicbot-vs-{competitor} — keep in sync with the route
 * files in admin-app/src/app/(public)/comparisons/.
 *
 * @type {Array<{ slug: string; competitor: string; hook: string }>}
 */
const LLMS_COMPARISONS = [
  { slug: 'manicbot-vs-booksy',   competitor: 'Booksy',   hook: '0% commission vs 30% Boost; Telegram + IG + WhatsApp booking vs Booksy app only; 45 PLN/mo vs ~145 PLN/mo.' },
  { slug: 'manicbot-vs-yclients', competitor: 'Yclients', hook: 'EU-region D1 storage and Polish-first UX vs Russia-domiciled platform; native multi-channel inbox vs paid 3rd-party messenger integrations.' },
  { slug: 'manicbot-vs-fresha',   competitor: 'Fresha',   hook: '0% commission forever vs 20% Fresha new-client fee; Telegram + AI receptionist vs marketplace funnel; flat 45-90 PLN/mo vs per-message WhatsApp fees.' },
  { slug: 'manicbot-vs-versum',   competitor: 'Versum',   hook: 'Active product roadmap vs Booksy-owned legacy; modern conversational booking vs SMS+forms; transparent pricing vs quote-only.' },
];

/**
 * Top FAQ pairs surfaced in llms.txt ## Frequently asked questions.
 * Short, direct answers — LLMs cite the first 1–2 sentences as the answer
 * when they hit a "how does ManicBot work" style query.
 *
 * @type {Array<{ q: string; a: string }>}
 */
const LLMS_FAQS = [
  { q: 'What does ManicBot cost?', a: '45 PLN/mo (Start, 1 master), 60 PLN/mo (Pro, 5 masters + AI + Google Calendar), 90 PLN/mo (Max, unlimited). 14-day free trial. No per-booking commission. No transaction fees.' },
  { q: 'Which booking channels does ManicBot support?', a: 'Telegram bot, Instagram Direct, WhatsApp Business, and an embeddable web chat widget. All four feed into one unified AI receptionist with a shared conversation history.' },
  { q: 'Does ManicBot work for independent nail masters or only for salons?', a: 'Both. Independent masters create a personal tenant on the same 45/60/90 PLN plans and manage their own services and schedule without belonging to a salon.' },
  { q: 'What languages does the AI receptionist speak?', a: 'Polish, Russian, Ukrainian, and English. The bot detects the client language from the first message and replies in the same language.' },
  { q: 'Does ManicBot take a commission on bookings?', a: 'No. The price is the monthly subscription only. No per-booking fee, no per-message fee, no marketplace cut — the booking flows through your own Telegram/Instagram/WhatsApp account, not through ManicBot.' },
  { q: 'How does the Google Calendar integration work?', a: 'Two-way sync. Busy blocks from the connected Google Calendar are honoured when the AI offers slots, and every confirmed appointment is mirrored back as a Calendar event the master can edit or move.' },
];

/**
 * Render `/llms.txt` per <https://llmstxt.org/>. Static markdown that LLM
 * crawlers consume for a one-page overview of the site. Goes alongside
 * sitemap.xml + robots.txt as a third "machine-readable site index" file.
 *
 * SEO audit 2026-05-20 P1-7 (initial) + 2026-05-20 P1-8 (expansion).
 * Adds: ## Top guides (10 blog articles with one-line summaries),
 * ## Comparisons (vs Booksy / Yclients / Fresha / Versum),
 * ## Frequently asked questions (6 short Q&A pairs).
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
    `- [Pricing](${base}/pricing) — plan comparison, FAQ, billing terms`,
    `- [About](${base}/about) — company info, founder, contact`,
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
    '## Top guides',
    '',
    ...LLMS_TOP_GUIDES.map((g) => `- [${g.title}](${base}/blog/${g.slug}) — ${g.summary}`),
    '',
    '## Comparisons',
    '',
    ...LLMS_COMPARISONS.map((c) => `- [ManicBot vs ${c.competitor}](${base}/comparisons/${c.slug}) — ${c.hook}`),
    '',
    '## Frequently asked questions',
    '',
    ...LLMS_FAQS.flatMap((f) => [`**${f.q}**`, '', f.a, '']),
    '## Programmatic surfaces',
    '',
    `- Salon profiles: ${base}/salon/{slug}`,
    `- City directory pages: ${base}/salons/{city-slug}`,
    `- Blog articles: ${base}/blog/{slug}`,
    `- Comparison pages: ${base}/comparisons/manicbot-vs-{competitor}`,
    '',
    '## Channels',
    '',
    'Each salon can connect any combination of: Telegram bot, Instagram Direct, WhatsApp Business, and an embeddable web chat widget. The same AI receptionist serves every channel with a unified conversation history.',
    '',
    '## Contact',
    '',
    `- Telegram: https://t.me/manicbot_com`,
    `- Email: support@manicbot.com`,
    `- Website: ${base}`,
    '',
  ].join('\n');
}

/**
 * Build the `/llms.txt` HTTP response.
 *
 * SEO audit 2026-05-20 P0-4: HEAD must return 200 with empty body and the
 * same Content-Type / Cache-Control so Bing/Meta crawler + uptime probes
 * don't see soft-404.
 *
 * @param {string} origin
 * @param {{ headOnly?: boolean }} [opts]
 */
export function generateLlmsTxtResponse(origin, opts = {}) {
  return new Response(opts.headOnly ? null : renderLlmsTxt(origin), {
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
 *
 * SEO audit 2026-05-20 P0-4: HEAD support (see generateLlmsTxtResponse).
 *
 * @param {string} origin
 * @param {{ headOnly?: boolean }} [opts]
 */
export function generateRobotsResponse(origin, opts = {}) {
  return new Response(opts.headOnly ? null : renderRobotsTxt(origin), {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
