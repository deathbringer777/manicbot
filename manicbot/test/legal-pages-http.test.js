/**
 * Tests for the Meta-App-Review-compliant static legal pages.
 *
 * Why critical: Meta App Review reviewers and the automated crawler
 * REJECT submissions when the Privacy / Data Deletion URLs return a
 * SPA shell with no static text, or when HEAD requests 404. Both
 * happened in production on 2026-05-14 before this fix.
 *
 * Real browsers (Mozilla UA, no crawler signature) get null for
 * /privacy and /terms so the landing SPA can render LegalPage.tsx
 * with the full Header / Footer design. /data-deletion is always
 * static — the SPA has no route for it.
 */
import { describe, it, expect } from 'vitest';
import { tryLegalPages } from '../src/http/legalPagesHttp.js';

function req(path, method = 'GET', headers = {}) {
  return new Request(`https://manicbot.com${path}`, { method, headers });
}

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FIREFOX_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0';
const SAFARI_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const FB_CRAWLER_UA = 'facebookexternalhit/1.1';
const META_AGENT_UA = 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

describe('tryLegalPages', () => {
  it('returns null for non-legal paths (caller falls through)', () => {
    expect(tryLegalPages(req('/'), new URL('https://manicbot.com/'))).toBeNull();
    expect(tryLegalPages(req('/blog'), new URL('https://manicbot.com/blog'))).toBeNull();
  });

  it('returns null for non-GET/HEAD methods', () => {
    expect(tryLegalPages(req('/privacy', 'POST'), new URL('https://manicbot.com/privacy'))).toBeNull();
  });

  describe.each([
    ['/privacy', 'Privacy Policy', 'Privacy Policy'],
    ['/data-deletion', 'Data Deletion', 'User Data Deletion Instructions'],
    ['/terms', 'Terms', 'Terms of Service'],
  ])('%s', (path, label, h1) => {
    it(`GET (no UA, like Meta crawler) → 200 with static ${label} HTML`, async () => {
      const res = tryLegalPages(req(path), new URL(`https://manicbot.com${path}`));
      expect(res).toBeTruthy();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toContain(`<h1>${h1}</h1>`);
      // Server-rendered HTML must contain real text without needing JS.
      expect(body).toContain('support@manicbot.com');
      expect(body.length).toBeGreaterThan(500);
    });

    it(`GET (Meta crawler UA) → 200 with static ${label} HTML`, async () => {
      const res = tryLegalPages(
        req(path, 'GET', { 'user-agent': FB_CRAWLER_UA }),
        new URL(`https://manicbot.com${path}`),
      );
      expect(res).toBeTruthy();
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`<h1>${h1}</h1>`);
    });

    it(`GET (meta-externalagent UA) → 200 with static ${label} HTML`, async () => {
      const res = tryLegalPages(
        req(path, 'GET', { 'user-agent': META_AGENT_UA }),
        new URL(`https://manicbot.com${path}`),
      );
      expect(res).toBeTruthy();
      expect(res.status).toBe(200);
    });

    it(`GET (Googlebot UA) → 200 with static ${label} HTML (SEO-friendly)`, async () => {
      const res = tryLegalPages(
        req(path, 'GET', { 'user-agent': GOOGLEBOT_UA }),
        new URL(`https://manicbot.com${path}`),
      );
      expect(res).toBeTruthy();
      expect(res.status).toBe(200);
    });

    it(`HEAD → 200 with no body (Meta crawler check)`, async () => {
      const res = tryLegalPages(req(path, 'HEAD'), new URL(`https://manicbot.com${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toBe('');  // HEAD has no body
    });

    it(`HEAD with browser UA still → 200 static (browsers don't HEAD)`, async () => {
      const res = tryLegalPages(
        req(path, 'HEAD', { 'user-agent': CHROME_UA }),
        new URL(`https://manicbot.com${path}`),
      );
      expect(res.status).toBe(200);
    });

    it(`accepts trailing slash and .html variants`, () => {
      expect(tryLegalPages(req(`${path}/`), new URL(`https://manicbot.com${path}/`))?.status).toBe(200);
      expect(tryLegalPages(req(`${path}.html`), new URL(`https://manicbot.com${path}.html`))?.status).toBe(200);
    });

    it('static HTML embeds the brand header + footer (no "deaf walls" for crawlers)', async () => {
      const res = tryLegalPages(req(path), new URL(`https://manicbot.com${path}`));
      const body = await res.text();
      expect(body).toContain('site-header');
      expect(body).toContain('site-footer');
      expect(body).toContain('ManicBot');
    });
  });

  describe('real-browser fall-through to landing SPA', () => {
    it.each([
      ['/privacy', CHROME_UA, 'Chrome'],
      ['/privacy', FIREFOX_UA, 'Firefox'],
      ['/privacy', SAFARI_IOS_UA, 'Safari iOS'],
      ['/terms', CHROME_UA, 'Chrome'],
      ['/terms', FIREFOX_UA, 'Firefox'],
      ['/terms', SAFARI_IOS_UA, 'Safari iOS'],
    ])('%s with %s UA → null (SPA renders LegalPage)', (path, ua) => {
      const res = tryLegalPages(
        req(path, 'GET', { 'user-agent': ua }),
        new URL(`https://manicbot.com${path}`),
      );
      expect(res).toBeNull();
    });

    it('also honors trailing slash and .html for browsers on /privacy', () => {
      expect(
        tryLegalPages(
          req('/privacy/', 'GET', { 'user-agent': CHROME_UA }),
          new URL('https://manicbot.com/privacy/'),
        ),
      ).toBeNull();
      expect(
        tryLegalPages(
          req('/privacy.html', 'GET', { 'user-agent': CHROME_UA }),
          new URL('https://manicbot.com/privacy.html'),
        ),
      ).toBeNull();
    });

    it('also honors trailing slash and .html for browsers on /terms', () => {
      expect(
        tryLegalPages(
          req('/terms/', 'GET', { 'user-agent': CHROME_UA }),
          new URL('https://manicbot.com/terms/'),
        ),
      ).toBeNull();
      expect(
        tryLegalPages(
          req('/terms.html', 'GET', { 'user-agent': CHROME_UA }),
          new URL('https://manicbot.com/terms.html'),
        ),
      ).toBeNull();
    });

    it('/data-deletion stays static even for real browsers (SPA has no route)', () => {
      const res = tryLegalPages(
        req('/data-deletion', 'GET', { 'user-agent': CHROME_UA }),
        new URL('https://manicbot.com/data-deletion'),
      );
      expect(res).toBeTruthy();
      expect(res.status).toBe(200);
    });
  });

  it('Data Deletion page has the Meta-required substantive content', async () => {
    const res = tryLegalPages(req('/data-deletion'), new URL('https://manicbot.com/data-deletion'));
    const body = await res.text();
    // Meta's checklist: how to request, response time, what gets deleted.
    expect(body).toMatch(/how to request/i);
    expect(body).toMatch(/30 days/i);
    expect(body).toMatch(/delete_my_data/i);
    expect(body).toMatch(/support@manicbot\.com/);
  });

  it('Privacy page covers GDPR Articles 15-22 rights', async () => {
    const res = tryLegalPages(req('/privacy'), new URL('https://manicbot.com/privacy'));
    const body = await res.text();
    expect(body).toMatch(/GDPR/);
    expect(body).toMatch(/retention/i);
    expect(body).toMatch(/cookie/i);
  });

  // Google OAuth verification (sensitive scopes) requires the policy URL +
  // "Limited Use" string to be discoverable on the Privacy Policy page —
  // reviewers grep for these. Don't drop these strings without coordinating
  // with the active OAuth verification submission.
  it('Privacy page declares Google API Services User Data Policy + Limited Use compliance', async () => {
    const res = tryLegalPages(req('/privacy'), new URL('https://manicbot.com/privacy'));
    const body = await res.text();
    expect(body).toMatch(/Google API Services User Data Policy/);
    expect(body).toMatch(/Limited Use/);
    expect(body).toMatch(/developers\.google\.com\/terms\/api-services-user-data-policy/);
    expect(body).toMatch(/calendar\.events/);
    expect(body).toMatch(/calendar\.readonly/);
  });
});
