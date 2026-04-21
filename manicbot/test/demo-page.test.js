import { describe, it, expect } from 'vitest';
import { tryDemoPage } from '../src/http/demoPageHttp.js';

function makeReq(method = 'GET', path = '/demo') {
  const url = new URL(`https://manicbot.com${path}`);
  return { request: { method }, url };
}

describe('tryDemoPage', () => {
  it('returns null for non-/demo paths', () => {
    const { request, url } = makeReq('GET', '/about');
    expect(tryDemoPage(request, {}, url)).toBeNull();
  });

  it('returns null for POST /demo', () => {
    const { request, url } = makeReq('POST', '/demo');
    expect(tryDemoPage(request, {}, url)).toBeNull();
  });

  it('returns 200 for GET /demo', async () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    expect(res).not.toBeNull();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  });

  it('returns 200 for HEAD /demo', async () => {
    const { request, url } = makeReq('HEAD', '/demo');
    const res = tryDemoPage(request, {}, url);
    expect(res.status).toBe(200);
  });

  it('includes the embed script tag', async () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    const html = await res.text();
    expect(html).toContain('/embed/demo-chat.js');
    expect(html).toContain('data-slug="preview-landing"');
    expect(html).toContain('data-target="#mb-demo"');
  });

  it('contains iPhone frame markup', async () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    const html = await res.text();
    expect(html).toContain('iphone');
    expect(html).toContain('id="mb-demo"');
  });

  it('sets X-Frame-Options to SAMEORIGIN', () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('sets no-cache header so updates ride the next deploy', () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
  });

  it('uses max(env(safe-area-inset-top),56px) on status-bar to clear the Dynamic Island', async () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    const html = await res.text();
    // Desktop browsers set safe-area-inset-top to 0 (not undefined), so a
    // plain env() fallback never fires. Using max(…,56px) guarantees clearance.
    expect(html).toContain('max(env(safe-area-inset-top),56px)');
    expect(html).toContain('padding-top:56px');
    expect(html).toContain('min-height:46px');
  });

  it('includes a prefers-color-scheme:dark block so the mockup adapts to dark sites', async () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    const html = await res.text();
    expect(html).toContain('prefers-color-scheme:dark');
  });

  // #S13 — CSP regression
  it('sets a strict Content-Security-Policy header', () => {
    const { request, url } = makeReq('GET', '/demo');
    const res = tryDemoPage(request, {}, url);
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    // script-src must NOT allow inline scripts (the page uses an external
    // <script src="/embed/...">), so a stray inline <script> would be blocked.
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
