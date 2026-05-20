/**
 * SEO audit 2026-05-20 P0-4 — tryLanding must accept HEAD.
 *
 * Bing crawler + Meta crawler + uptime monitors probe HEAD before GET.
 * The landing root (`/`) and other landing-proxied paths (`/privacy`,
 * `/terms`, `/cookies`, `/support`) MUST return 200 on HEAD so they
 * don't get treated as dead URLs.
 *
 * This test stubs `globalThis.fetch` so we can assert the method
 * forwarded upstream + the returned body shape, without making a real
 * network call. The seo.js generators (robots.txt, sitemap.xml, llms.txt)
 * are tested in test/seo.test.js — this file covers the landing-proxy
 * branch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tryLanding } from '../src/http/landingHttp.js';

const ORIGINAL_FETCH = globalThis.fetch;

function makeRequest(pathname, method) {
  return new Request(`https://manicbot.com${pathname}`, { method });
}

describe('tryLanding — HEAD method support (P0-4)', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async (_url, init) => {
      // Mirror Cloudflare Pages behaviour: HEAD returns 200 with empty body
      // and the same Content-Type a GET would carry. The mock just echoes
      // a minimal HTML response with the upstream Content-Type so the
      // pass-through path can be exercised.
      return new Response(init?.method === 'HEAD' ? null : '<!doctype html><html><body>landing</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    });
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('forwards HEAD to the landing origin (not rewritten to GET)', async () => {
    const req = makeRequest('/', 'HEAD');
    const url = new URL(req.url);
    await tryLanding(req, {}, url);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe('HEAD');
  });

  it('returns 200 with empty body on HEAD /', async () => {
    const req = makeRequest('/', 'HEAD');
    const url = new URL(req.url);
    const res = await tryLanding(req, {}, url);
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    // HEAD must not include a body — the bridge-script injection is
    // explicitly skipped on the HEAD path.
    const text = await res.text();
    expect(text).toBe('');
  });

  it('returns 200 with empty body on HEAD /cookies (landing-served legal page)', async () => {
    const req = makeRequest('/cookies', 'HEAD');
    const url = new URL(req.url);
    const res = await tryLanding(req, {}, url);
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('returns 200 with empty body on HEAD /support', async () => {
    const req = makeRequest('/support', 'HEAD');
    const url = new URL(req.url);
    const res = await tryLanding(req, {}, url);
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('GET / still injects the bridge script (regression pin)', async () => {
    const req = makeRequest('/', 'GET');
    const url = new URL(req.url);
    const res = await tryLanding(req, {}, url);
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    const text = await res.text();
    // The injected bridge IIFE uses `__mbBridgeBooted` as its
    // re-entry guard — presence on the HTML proves injection happened.
    expect(text).toContain('__mbBridgeBooted');
  });

  it('returns null for unsupported methods (POST/PUT)', async () => {
    const url = new URL('https://manicbot.com/');
    expect(await tryLanding(new Request(url, { method: 'POST' }), {}, url)).toBeNull();
    // PUT requires a body for the constructor; pass an empty string.
    expect(await tryLanding(new Request(url, { method: 'PUT', body: '' }), {}, url)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null for non-landing paths (e.g. /webhook) even on HEAD', async () => {
    const url = new URL('https://manicbot.com/webhook/123');
    const res = await tryLanding(new Request(url, { method: 'HEAD' }), {}, url);
    expect(res).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// SEO audit 2026-05-20 P0-7 — soft-404 trap on the Vite SPA catch-all.
//
// The landing is a Vite SPA. Vite's dev server and the production static
// hosting both return `dist/index.html` (the SPA shell) for any path that
// doesn't match a file — so `/pricing`, `/cennik`, `/cities`, `/pl/about`,
// `/en`, `/ru` all returned HTTP 200 with the landing HTML when probed.
// Google treats that as a soft-404 and penalises the domain.
//
// The Worker calls `tryLanding(force=true)` in two places (worker.js lines
// 476 and 544) for any GET that doesn't match an explicit handler. The
// fix lives in `tryLanding`: when `force=true` AND the path is NOT in
// the curated `isLandingPath` allowlist, the upstream response status is
// overridden to 404. Body is preserved so a human visitor still sees the
// landing's branded 404 page; crawlers see status=404 and stop indexing.
describe('tryLanding — soft-404 guard on unknown SPA paths (P0-7)', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () =>
      // Vite serves dist/index.html with 200 for any unknown path.
      new Response('<!doctype html><html><body>SPA shell</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('returns 404 for an unknown SPA path under force=true (/pricing)', async () => {
    const url = new URL('https://manicbot.com/pricing');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url, /* force */ true);
    expect(res).not.toBeNull();
    expect(res.status).toBe(404);
    // Body preserved so the SPA can render a styled 404 for humans.
    expect(await res.text()).toContain('SPA shell');
  });

  it('returns 404 for nested unknown paths (/pl/about, /en/pricing)', async () => {
    const cases = ['/pl/about', '/en/pricing', '/cennik', '/cities', '/locations', '/ru'];
    for (const path of cases) {
      const url = new URL(`https://manicbot.com${path}`);
      const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url, true);
      expect(res, `expected non-null for ${path}`).not.toBeNull();
      expect(res.status, `expected 404 for ${path}`).toBe(404);
    }
  });

  it('keeps 200 on the landing root (/)', async () => {
    const url = new URL('https://manicbot.com/');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url, true);
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
  });

  it('keeps 200 on allowlisted legal pages (/cookies, /support, /privacy, /terms)', async () => {
    for (const path of ['/cookies', '/support', '/privacy', '/terms']) {
      const url = new URL(`https://manicbot.com${path}`);
      const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url, true);
      expect(res, `expected non-null for ${path}`).not.toBeNull();
      expect(res.status, `expected 200 for ${path}`).toBe(200);
    }
  });

  it('preserves upstream 5xx/3xx — only the 200-shell soft-404 is rewritten', async () => {
    fetchSpy.mockImplementationOnce(async () =>
      new Response('upstream broken', { status: 502 }),
    );
    const url = new URL('https://manicbot.com/unknown');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url, true);
    expect(res).not.toBeNull();
    expect(res.status).toBe(502);
  });

  it('HEAD on an unknown path also returns 404 (not 200)', async () => {
    fetchSpy.mockImplementationOnce(async () =>
      new Response(null, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    const url = new URL('https://manicbot.com/pricing');
    const res = await tryLanding(new Request(url, { method: 'HEAD' }), {}, url, true);
    expect(res).not.toBeNull();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });
});

// SEO audit 2026-05-20 P0-5 — LLM-crawler visibility on the landing root.
//
// The Vite SPA renders 0 words server-side; the body is `<div id="root">
// </div>` until React hydrates. Googlebot can render JS, but GPTBot,
// ClaudeBot, PerplexityBot, CCBot and Google-Extended do NOT execute JS
// — they see an empty body and skip the page entirely. Robots.txt
// explicitly allows them but they have nothing to read.
//
// Fix: the Worker injects a `<noscript>` content block + a JSON-LD
// SoftwareApplication payload into the landing HTML before the closing
// `</body>`. The block contains the H1, USP, pricing, top features as
// plain text — visible to every non-JS crawler. The JSON-LD lives
// directly in the HTML so crawlers that ignore noscript still see it.
describe('tryLanding — LLM noscript block on landing root (P0-5)', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () =>
      // Vite SPA shell — empty body, JS-only.
      new Response('<!doctype html><html><head><title>ManicBot</title></head><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('injects noscript H1 + tagline + 0% commission USP on GET /', async () => {
    const url = new URL('https://manicbot.com/');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url);
    const html = await res.text();
    expect(html).toContain('<noscript');
    expect(html).toContain('ManicBot');
    expect(html).toContain('Telegram');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('Instagram');
    // 0% commission is the strongest competitive USP — must be in plain text.
    expect(html).toMatch(/0\s*%/);
  });

  it('injects pricing for all 3 plans (Start 45 / Pro 60 / Max 90) in plain text', async () => {
    const url = new URL('https://manicbot.com/');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url);
    const html = await res.text();
    expect(html).toMatch(/Start.{0,30}45/);
    expect(html).toMatch(/Pro.{0,30}60/);
    expect(html).toMatch(/Max.{0,30}90/);
  });

  it('injects SoftwareApplication JSON-LD with Offer prices and PLN currency', async () => {
    const url = new URL('https://manicbot.com/');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url);
    const html = await res.text();
    expect(html).toContain('"@type":"SoftwareApplication"');
    expect(html).toContain('"@context":"https://schema.org"');
    expect(html).toContain('"priceCurrency":"PLN"');
    expect(html).toContain('"price":"45"');
    expect(html).toContain('"price":"60"');
    expect(html).toContain('"price":"90"');
  });

  it('preserves the existing bridge-script injection on /', async () => {
    const url = new URL('https://manicbot.com/');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url);
    const html = await res.text();
    expect(html).toContain('__mbBridgeBooted');
  });

  it('does NOT inject the noscript block on non-homepage paths (/privacy)', async () => {
    const url = new URL('https://manicbot.com/privacy');
    const res = await tryLanding(new Request(url, { method: 'GET' }), {}, url);
    const html = await res.text();
    // Whatever upstream returns, no SEO injection on legal pages.
    expect(html).not.toContain('"@type":"SoftwareApplication"');
  });

  it('does NOT inject on HEAD / (no body to inject into)', async () => {
    const url = new URL('https://manicbot.com/');
    const res = await tryLanding(new Request(url, { method: 'HEAD' }), {}, url);
    expect(await res.text()).toBe('');
  });
});
