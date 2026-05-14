/**
 * Tests for the Meta-App-Review-compliant static legal pages.
 *
 * Why critical: Meta App Review reviewers and the automated crawler
 * REJECT submissions when the Privacy / Data Deletion URLs return a
 * SPA shell with no static text, or when HEAD requests 404. Both
 * happened in production on 2026-05-14 before this fix.
 */
import { describe, it, expect } from 'vitest';
import { tryLegalPages } from '../src/http/legalPagesHttp.js';

function req(path, method = 'GET') {
  return new Request(`https://manicbot.com${path}`, { method });
}

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
    it(`GET → 200 with static ${label} HTML`, async () => {
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

    it(`HEAD → 200 with no body (Meta crawler check)`, async () => {
      const res = tryLegalPages(req(path, 'HEAD'), new URL(`https://manicbot.com${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toBe('');  // HEAD has no body
    });

    it(`accepts trailing slash and .html variants`, () => {
      expect(tryLegalPages(req(`${path}/`), new URL(`https://manicbot.com${path}/`))?.status).toBe(200);
      expect(tryLegalPages(req(`${path}.html`), new URL(`https://manicbot.com${path}.html`))?.status).toBe(200);
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
});
