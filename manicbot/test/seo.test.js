import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_ORIGIN,
  buildStaticSitemapEntries,
  renderSitemapXml,
  renderRobotsTxt,
  generateSitemapResponse,
  generateRobotsResponse,
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

    it('includes auth entry points (login/register) at low priority', () => {
      const login = entries.find((e) => e.loc === '/login');
      const register = entries.find((e) => e.loc === '/register');
      expect(login).toBeTruthy();
      expect(register).toBeTruthy();
      expect(login.priority).toBe('0.3');
    });

    it('includes blog article slugs', () => {
      const slugs = entries.filter((e) => e.loc.startsWith('/blog/')).map((e) => e.loc);
      expect(slugs).toContain('/blog/automate-salon-booking');
      expect(slugs).toContain('/blog/reduce-no-shows');
      expect(slugs).toContain('/blog/nail-trends-2026');
      expect(slugs).toContain('/blog/whatsapp-instagram-channels');
      expect(slugs).toContain('/blog/google-calendar-sync');
      expect(slugs).toContain('/blog/first-client-in-10-minutes');
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

  describe('generateSitemapResponse', () => {
    it('returns XML content-type with 1h cache', async () => {
      const res = await generateSitemapResponse({}, 'https://manicbot.com');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/xml/);
      expect(res.headers.get('cache-control')).toContain('max-age=3600');
    });

    it('includes DB salon slugs when DB binding is present', async () => {
      const mockDb = {
        prepare: () => ({
          all: async () => ({
            results: [
              { slug: 'salon-alpha', updated_at: '2026-03-20T12:00:00Z' },
              { slug: 'salon-beta',  updated_at: null },
            ],
          }),
        }),
      };
      const res = await generateSitemapResponse({ DB: mockDb }, 'https://manicbot.com');
      const body = await res.text();
      expect(body).toContain('/salon/salon-alpha');
      expect(body).toContain('/salon/salon-beta');
      expect(body).toContain('2026-03-20');
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
  });
});
