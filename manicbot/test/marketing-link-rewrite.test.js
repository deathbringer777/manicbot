/**
 * Email link-rewriting tests — only http(s) links go through /r/; the
 * unsubscribe link, mailto:/tel:, and already-wrapped links are left alone.
 * Fail-open when no secret. Idempotent on a second pass.
 */
import { describe, it, expect } from 'vitest';
import { rewriteLinksForTracking } from '../src/services/marketing/linkRewrite.js';
import { verifyClickToken } from '../src/services/marketing/clickToken.js';

const SECRET = 'rewrite-secret-which-is-long-enough';
const BASE = {
  origin: 'https://manicbot.com', campaignId: 'cmp_1', sendId: 'snd_1',
  tenantId: 't_a', contactId: 7, secret: SECRET,
};

describe('rewriteLinksForTracking', () => {
  it('rewrites http(s) links and skips unsubscribe / mailto / tel', async () => {
    const html = [
      '<a href="https://salon.example/book">Book</a>',
      '<a href="https://manicbot.com/u/abc123">unsubscribe</a>',
      '<a href="mailto:hi@x.com">mail</a>',
      '<a href="tel:+48123">call</a>',
    ].join('\n');
    const out = await rewriteLinksForTracking(html, BASE);

    expect(out).toContain('https://manicbot.com/r/');
    expect(out).toContain('/u/abc123');          // unsubscribe untouched
    expect(out).toContain('mailto:hi@x.com');
    expect(out).toContain('tel:+48123');
    expect(out).not.toContain('href="https://salon.example/book"');

    const m = out.match(/\/r\/([A-Za-z0-9._-]+)/);
    const claims = await verifyClickToken(SECRET, m[1]);
    expect(claims.url).toBe('https://salon.example/book');
    expect(claims.campaignId).toBe('cmp_1');
    expect(claims.sendId).toBe('snd_1');
  });

  it('returns the original html when no secret is configured', async () => {
    const html = '<a href="https://x.example/y">y</a>';
    expect(await rewriteLinksForTracking(html, { ...BASE, secret: '' })).toBe(html);
  });

  it('is idempotent — already-wrapped /r/ links are not re-wrapped', async () => {
    const html = '<a href="https://salon.example/book">b</a>';
    const once = await rewriteLinksForTracking(html, BASE);
    const twice = await rewriteLinksForTracking(once, BASE);
    expect(twice).toBe(once);
  });

  it('handles single-quoted hrefs', async () => {
    const html = "<a href='https://salon.example/x'>x</a>";
    const out = await rewriteLinksForTracking(html, BASE);
    expect(out).toContain("/r/");
    expect(out).not.toContain("href='https://salon.example/x'");
  });
});
