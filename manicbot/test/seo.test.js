import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_ORIGIN,
  ROUTE_LASTMOD,
  buildStaticSitemapEntries,
  renderSitemapXml,
  renderRobotsTxt,
  generateSitemapResponse,
  generateRobotsResponse,
  generateLlmsTxtResponse,
  renderLlmsTxt,
  citySlug,
  coerceLastmodDate,
} from '../src/utils/seo.js';

describe('seo', () => {
  describe('buildStaticSitemapEntries', () => {
    const entries = buildStaticSitemapEntries('2026-04-07');

    it('includes the landing root', () => {
      expect(entries.find((e) => e.loc === '/')).toBeTruthy();
    });

    it('includes legal SPA routes (proxied to landing)', () => {
      expect(entries.find((e) => e.loc === '/privacy')).toBeTruthy();
      expect(entries.find((e) => e.loc === '/terms')).toBeTruthy();
      expect(entries.find((e) => e.loc === '/cookies')).toBeTruthy();
      expect(entries.find((e) => e.loc === '/support')).toBeTruthy();
    });

    it('includes admin-app public routes (blog/help/rules/search)', () => {
      expect(entries.find((e) => e.loc === '/search')).toBeTruthy();
      expect(entries.find((e) => e.loc === '/blog')).toBeTruthy();
      expect(entries.find((e) => e.loc === '/help')).toBeTruthy();
      expect(entries.find((e) => e.loc === '/rules')).toBeTruthy();
    });

    // #P0-4d (relax.md §3) — auth pages must NOT be in the sitemap. They
    // are rendered with `<meta name="robots" content="noindex,nofollow">`,
    // and listing them while marking them noindex sends Google a
    // contradictory signal that hurts the rest of the sitemap's trust.
    it('does NOT include auth entry points (login/register) — #P0-4d', () => {
      expect(entries.find((e) => e.loc === '/login')).toBeUndefined();
      expect(entries.find((e) => e.loc === '/register')).toBeUndefined();
    });

    it('includes blog article slugs (all 10 articles, May 2026 SEO sweep)', () => {
      const slugs = entries.filter((e) => e.loc.startsWith('/blog/')).map((e) => e.loc);
      // Original 6 (rewritten long-form in 4 langs).
      expect(slugs).toContain('/blog/automate-salon-booking');
      expect(slugs).toContain('/blog/reduce-no-shows');
      expect(slugs).toContain('/blog/nail-trends-2026');
      expect(slugs).toContain('/blog/whatsapp-instagram-channels');
      expect(slugs).toContain('/blog/google-calendar-sync');
      expect(slugs).toContain('/blog/first-client-in-10-minutes');
      // New articles authored in May 2026 from latest beauty/AI research.
      expect(slugs).toContain('/blog/channels-compared-2026');
      expect(slugs).toContain('/blog/nail-clients-survey-2026');
      expect(slugs).toContain('/blog/ai-receptionist-247');
      expect(slugs).toContain('/blog/dynamic-pricing-salon');
    });

    it('every entry has lastmod, priority, changefreq', () => {
      for (const e of entries) {
        expect(e.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.priority).toMatch(/^(0|1)\.\d$/);
        expect(['yearly', 'monthly', 'weekly', 'daily', 'hourly']).toContain(e.changefreq);
      }
    });

    it('/ has the highest priority', () => {
      const root = entries.find((e) => e.loc === '/');
      expect(root.priority).toBe('1.0');
    });

    // #P0-4c (relax.md §3) — previously every static entry was stamped with
    // today's date on every fetch. Google flagged this as fake-freshness
    // and discounted the entire sitemap. The fix is a route-keyed lastmod
    // table; routes get their committed date, not the fetch-time date.
    describe('#P0-4c — per-route lastmod', () => {
      it('uses ROUTE_LASTMOD for routes that have an entry', () => {
        const today = '2026-04-07';
        const fresh = buildStaticSitemapEntries(today);
        expect(fresh.find((e) => e.loc === '/').lastmod).toBe(ROUTE_LASTMOD['/']);
        expect(fresh.find((e) => e.loc === '/help').lastmod).toBe(ROUTE_LASTMOD['/help']);
        expect(fresh.find((e) => e.loc === '/search').lastmod).toBe(ROUTE_LASTMOD['/search']);
        expect(fresh.find((e) => e.loc === '/blog').lastmod).toBe(ROUTE_LASTMOD['/blog']);
        expect(fresh.find((e) => e.loc === '/privacy').lastmod).toBe(ROUTE_LASTMOD['/privacy']);
        expect(fresh.find((e) => e.loc === '/terms').lastmod).toBe(ROUTE_LASTMOD['/terms']);
        expect(fresh.find((e) => e.loc === '/cookies').lastmod).toBe(ROUTE_LASTMOD['/cookies']);
      });

      it('preserves the per-article BLOG_ARTICLES lastmod (not today)', () => {
        const today = '2099-01-01';
        const fresh = buildStaticSitemapEntries(today);
        // automate-salon-booking was rewritten long-form in May 2026; its
        // hardcoded lastmod matches the rewrite date, not today.
        const post = fresh.find((e) => e.loc === '/blog/automate-salon-booking');
        expect(post.lastmod).toBe('2026-05-16');
        expect(post.lastmod).not.toBe(today);
        // A newly-authored article keeps its publish date as lastmod.
        const fresh2 = fresh.find((e) => e.loc === '/blog/channels-compared-2026');
        expect(fresh2.lastmod).toBe('2026-05-15');
      });

      it('emits varied lastmod values across routes (not all the same today)', () => {
        const today = '2099-01-01';
        const fresh = buildStaticSitemapEntries(today);
        const lastmods = new Set(fresh.map((e) => e.lastmod));
        // We expect at least 3 distinct dates across the catalog.
        expect(lastmods.size).toBeGreaterThanOrEqual(3);
        // None of the static routes in ROUTE_LASTMOD should pick up the
        // synthetic far-future `today`, which would mean the table missed.
        for (const loc of Object.keys(ROUTE_LASTMOD)) {
          const entry = fresh.find((e) => e.loc === loc);
          if (entry) expect(entry.lastmod).not.toBe(today);
        }
      });

      it('falls back to `today` only for routes not in ROUTE_LASTMOD', () => {
        const today = '2099-01-01';
        const fresh = buildStaticSitemapEntries(today);
        // `/rules` and `/support` are static routes without an explicit
        // ROUTE_LASTMOD entry today; they should still receive `today` so
        // we never emit a missing <lastmod>.
        const rules = fresh.find((e) => e.loc === '/rules');
        if (rules) expect(rules.lastmod).toBe(today);
        const support = fresh.find((e) => e.loc === '/support');
        if (support) expect(support.lastmod).toBe(today);
      });
    });
  });

  describe('renderSitemapXml', () => {
    it('emits valid XML with the xmlns', () => {
      const xml = renderSitemapXml([{ loc: '/x', priority: '0.5', changefreq: 'weekly' }], 'https://example.com');
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
      expect(xml).toContain('<loc>https://example.com/x</loc>');
      expect(xml).toContain('<priority>0.5</priority>');
      expect(xml).toContain('<changefreq>weekly</changefreq>');
    });

    it('includes lastmod when provided', () => {
      const xml = renderSitemapXml(
        [{ loc: '/x', priority: '0.5', changefreq: 'weekly', lastmod: '2026-04-07' }],
        'https://example.com',
      );
      expect(xml).toContain('<lastmod>2026-04-07</lastmod>');
    });

    it('strips trailing slash from origin', () => {
      const xml = renderSitemapXml([{ loc: '/a', priority: '0.5', changefreq: 'weekly' }], 'https://example.com/');
      expect(xml).toContain('<loc>https://example.com/a</loc>');
      expect(xml).not.toContain('example.com//a');
    });

    it('defaults to DEFAULT_SITE_ORIGIN when no base passed', () => {
      const xml = renderSitemapXml([{ loc: '/', priority: '1.0', changefreq: 'weekly' }]);
      expect(xml).toContain(`<loc>${DEFAULT_SITE_ORIGIN}/</loc>`);
    });

    it('escapes XML entities in urls', () => {
      const xml = renderSitemapXml(
        [{ loc: '/search?q=a&b=c', priority: '0.5', changefreq: 'daily' }],
        'https://example.com',
      );
      expect(xml).toContain('&amp;');
      expect(xml).not.toMatch(/q=a&b=/);
    });
  });

  describe('renderRobotsTxt', () => {
    const txt = renderRobotsTxt('https://manicbot.com');

    it('includes the Sitemap directive with absolute URL', () => {
      expect(txt).toContain('Sitemap: https://manicbot.com/sitemap.xml');
    });

    it('allows the public pages', () => {
      expect(txt).toMatch(/^Allow: \/$/m);
      expect(txt).toMatch(/^Allow: \/blog$/m);
      expect(txt).toMatch(/^Allow: \/help$/m);
      expect(txt).toMatch(/^Allow: \/search$/m);
      expect(txt).toMatch(/^Allow: \/salon\/$/m);
    });

    it('disallows internal / API paths', () => {
      expect(txt).toMatch(/^Disallow: \/admin$/m);
      expect(txt).toMatch(/^Disallow: \/api\/$/m);
      expect(txt).toMatch(/^Disallow: \/webhook$/m);
      expect(txt).toMatch(/^Disallow: \/stripe\/$/m);
      expect(txt).toMatch(/^Disallow: \/google\/$/m);
    });

    it('disallows auth flow pages (to avoid thin-content duplicates)', () => {
      expect(txt).toMatch(/^Disallow: \/login$/m);
      expect(txt).toMatch(/^Disallow: \/forgot-password$/m);
      expect(txt).toMatch(/^Disallow: \/reset-password$/m);
      expect(txt).toMatch(/^Disallow: \/verify-email$/m);
    });

    it('disallows dashboard-only surfaces', () => {
      expect(txt).toMatch(/^Disallow: \/dashboard$/m);
      expect(txt).toMatch(/^Disallow: \/appointments$/m);
      expect(txt).toMatch(/^Disallow: \/tenants$/m);
      expect(txt).toMatch(/^Disallow: \/settings$/m);
    });

    it('strips trailing slash from origin when building Sitemap url', () => {
      const t = renderRobotsTxt('https://manicbot.com/');
      expect(t).toContain('Sitemap: https://manicbot.com/sitemap.xml');
      expect(t).not.toContain('manicbot.com//sitemap.xml');
    });
  });

  describe('coerceLastmodDate', () => {
    it('returns null for null/undefined/empty', () => {
      expect(coerceLastmodDate(null)).toBeNull();
      expect(coerceLastmodDate(undefined)).toBeNull();
      expect(coerceLastmodDate('')).toBeNull();
    });

    it('passes through ISO YYYY-MM-DD dates', () => {
      expect(coerceLastmodDate('2026-04-07')).toBe('2026-04-07');
    });

    it('truncates ISO datetime to YYYY-MM-DD', () => {
      expect(coerceLastmodDate('2026-04-07T12:34:56Z')).toBe('2026-04-07');
      expect(coerceLastmodDate('2026-04-07T00:00:00.000Z')).toBe('2026-04-07');
    });

    it('converts SQLite epoch seconds (INTEGER) to YYYY-MM-DD', () => {
      // 1774796426 = 2026-03-29T14:20:26Z
      expect(coerceLastmodDate(1774796426)).toBe('2026-03-29');
      // 0 = 1970-01-01
      expect(coerceLastmodDate(0)).toBe('1970-01-01');
    });

    it('converts epoch milliseconds (large numbers) to YYYY-MM-DD', () => {
      // 1774796426000 = same moment as above, but in ms
      expect(coerceLastmodDate(1774796426000)).toBe('2026-03-29');
    });

    it('converts numeric strings as epoch', () => {
      expect(coerceLastmodDate('1774796426')).toBe('2026-03-29');
    });

    it('returns null for garbage input', () => {
      expect(coerceLastmodDate('not-a-date')).toBeNull();
      expect(coerceLastmodDate({})).toBeNull();
      expect(coerceLastmodDate([])).toBeNull();
      expect(coerceLastmodDate(NaN)).toBeNull();
    });
  });

  describe('generateSitemapResponse', () => {
    it('returns XML content-type with 1h cache', async () => {
      const res = await generateSitemapResponse({}, 'https://manicbot.com');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/xml/);
      expect(res.headers.get('cache-control')).toContain('max-age=3600');
    });

    it('includes DB salon slugs with ISO-formatted lastmod (from epoch int)', async () => {
      const mockDb = {
        prepare: () => ({
          all: async () => ({
            results: [
              // updated_at stored as INTEGER epoch seconds (schema.sql tenants.updated_at)
              { slug: 'salon-alpha', updated_at: 1774796426 }, // 2026-03-29
              { slug: 'salon-beta',  updated_at: null },        // falls back to today
              { slug: 'salon-gamma', updated_at: '2026-03-20T12:00:00Z' }, // ISO string
            ],
          }),
        }),
      };
      const res = await generateSitemapResponse({ DB: mockDb }, 'https://manicbot.com');
      const body = await res.text();
      expect(body).toContain('/salon/salon-alpha');
      expect(body).toContain('/salon/salon-beta');
      expect(body).toContain('/salon/salon-gamma');
      expect(body).toContain('2026-03-29');
      expect(body).toContain('2026-03-20');
      // Every lastmod must be YYYY-MM-DD — no raw epoch integers leaking through
      const lastmodMatches = [...body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)];
      for (const [, val] of lastmodMatches) {
        expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    // SEO audit 2026-05-20 P0-3 + P1-10 — auto-generated sitemap MUST exclude
    // synthetic test accounts. Previously the sitemap query was
    // `public_active=1 AND slug IS NOT NULL` and emitted all 16 demo/test
    // salons because they all had `public_active=1`. Filter `is_test=0` to
    // keep test accounts out of the production index.
    it('excludes test/demo salons (is_test=1) from sitemap', async () => {
      const calls = [];
      const mockDb = {
        prepare: (sql) => {
          calls.push(sql);
          return {
            all: async () => ({
              // The DB returns the FILTERED rows — proves the WHERE clause is right.
              results: [
                { slug: 'real-salon-a', updated_at: 1774796426 },
                { slug: 'real-salon-b', updated_at: 1774796426 },
              ],
            }),
          };
        },
      };
      const res = await generateSitemapResponse({ DB: mockDb }, 'https://manicbot.com');
      const body = await res.text();
      // Filter must be in the SELECT clause so the DB does the work.
      expect(calls[0]).toMatch(/is_test\s*=\s*0/i);
      expect(body).toContain('/salon/real-salon-a');
      expect(body).toContain('/salon/real-salon-b');
    });

    // SEO audit 2026-05-20 P1-1 — programmatic city directory pages.
    // The sitemap must surface `/salons/{slug}` so Google can discover them.
    it('includes programmatic city pages at /salons/{city-slug}', async () => {
      const mockDb = {
        prepare: () => ({
          all: async () => ({ results: [] }),
        }),
      };
      const res = await generateSitemapResponse({ DB: mockDb }, 'https://manicbot.com');
      const body = await res.text();
      // POPULAR_CITIES from src/lib/popularCities.js — Warszawa, Gdańsk, Wrocław.
      // The Worker URL-slugifies the city name (lowercase, ASCII).
      expect(body).toContain('/salons/warszawa');
      expect(body).toContain('/salons/gdansk');
      expect(body).toContain('/salons/wroclaw');
    });

    it('survives DB errors and still returns static sitemap', async () => {
      const mockDb = { prepare: () => ({ all: async () => { throw new Error('db down'); } }) };
      const res = await generateSitemapResponse({ DB: mockDb }, 'https://manicbot.com');
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('https://manicbot.com/');
      expect(body).toContain('https://manicbot.com/blog');
    });

    it('falls back to DEFAULT_SITE_ORIGIN when origin is empty', async () => {
      const res = await generateSitemapResponse({}, '');
      const body = await res.text();
      expect(body).toContain(DEFAULT_SITE_ORIGIN);
    });
  });

  describe('generateRobotsResponse', () => {
    it('returns text/plain with 24h cache', async () => {
      const res = generateRobotsResponse('https://manicbot.com');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
      expect(res.headers.get('cache-control')).toContain('max-age=86400');
      const body = await res.text();
      expect(body).toContain('Sitemap: https://manicbot.com/sitemap.xml');
    });

    // SEO audit 2026-05-20 P2-5 — explicit allow blocks for AI bots so the
    // policy is on the public record. Defaults to `*` allow today; this is
    // belt-and-suspenders for paper trail.
    it('explicitly allows AI bots (GPTBot, ClaudeBot, Google-Extended, PerplexityBot)', async () => {
      const res = generateRobotsResponse('https://manicbot.com');
      const body = await res.text();
      expect(body).toContain('User-agent: GPTBot');
      expect(body).toContain('User-agent: ClaudeBot');
      expect(body).toContain('User-agent: Google-Extended');
      expect(body).toContain('User-agent: PerplexityBot');
    });
  });

  // SEO audit 2026-05-20 P1-7 — /llms.txt (https://llmstxt.org).
  describe('renderLlmsTxt', () => {
    const txt = renderLlmsTxt('https://manicbot.com');

    it('starts with a single H1 line (llmstxt.org requires this)', () => {
      const firstLine = txt.split('\n')[0];
      expect(firstLine).toMatch(/^# /);
    });

    it('describes ManicBot in a single short paragraph (the "blockquote" summary)', () => {
      // The spec calls for a short summary immediately after the H1.
      expect(txt).toMatch(/AI[\s-]?booking|nail salon|salon paznokci/i);
    });

    it('links to the salon directory + blog as primary resources', () => {
      expect(txt).toContain('https://manicbot.com/search');
      expect(txt).toContain('https://manicbot.com/blog');
      expect(txt).toContain('https://manicbot.com/sitemap.xml');
    });

    it('lists supported languages', () => {
      // Should mention all 4 languages.
      expect(txt).toMatch(/ru|Russian/i);
      expect(txt).toMatch(/pl|Polish/i);
      expect(txt).toMatch(/en|English/i);
      expect(txt).toMatch(/uk|ua|Ukrainian/i);
    });

    it('emits pricing summary so LLMs can answer cost questions correctly', () => {
      expect(txt).toMatch(/45.*PLN|from\s+45|od\s+45/i);
    });
  });

  describe('generateLlmsTxtResponse', () => {
    it('returns text/markdown with 24h cache', async () => {
      const res = generateLlmsTxtResponse('https://manicbot.com');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/(markdown|plain)/);
      expect(res.headers.get('cache-control')).toContain('max-age=86400');
    });
  });

  // SEO audit 2026-05-20 — used by both the sitemap and the
  // /salons/{city} route to keep slug shape consistent. ASCII-fold so
  // "Wrocław" → "wroclaw" and "Gdańsk" → "gdansk".
  describe('citySlug', () => {
    it.each([
      ['Warszawa', 'warszawa'],
      ['Gdańsk', 'gdansk'],
      ['Wrocław', 'wroclaw'],
      ['Kraków', 'krakow'],
      ['Łódź', 'lodz'],
      ['Poznań', 'poznan'],
    ])('citySlug(%s) → %s', (input, expected) => {
      expect(citySlug(input)).toBe(expected);
    });

    it('returns empty string for null/undefined/empty', () => {
      expect(citySlug(null)).toBe('');
      expect(citySlug(undefined)).toBe('');
      expect(citySlug('')).toBe('');
    });

    it('strips leading/trailing dashes and collapses whitespace', () => {
      expect(citySlug('  Hello World  ')).toBe('hello-world');
    });
  });
});
