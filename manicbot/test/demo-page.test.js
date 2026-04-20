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
});
