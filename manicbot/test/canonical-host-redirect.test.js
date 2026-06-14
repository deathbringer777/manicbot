/**
 * Canonical host + scheme redirect (SEO de-duplication).
 *
 * Root cause: both `manicbot.com` and `www.manicbot.com` are bound to the
 * Worker (wrangler.toml custom_domain x2) and Cloudflare "Always Use HTTPS" is
 * off, so `http://manicbot.com/`, `http://www.manicbot.com/` and
 * `https://www.manicbot.com/` all returned 200 with identical content. Google
 * Search Console flagged these as "Page with redirect" / duplicate-canonical
 * noise (verified 2026-06-14).
 *
 * Fix: the Worker 301s any www host or http scheme onto the canonical origin
 * `https://manicbot.com`, preserving path + query. GET/HEAD only — never
 * rewrite a POST body (webhooks/API post to the apex https origin).
 *
 * This file pins both the pure decision (`canonicalHostRedirect`) and its
 * consequence in `worker.fetch`.
 */
import { describe, it, expect } from 'vitest';
import { canonicalHostRedirect } from '../src/http/canonicalHostHttp.js';
import workerDefault from '../src/worker.js';

const req = (url, init) => new Request(url, init);

describe('canonicalHostRedirect — pure decision', () => {
  it('301s www → apex, preserving path + query', () => {
    expect(canonicalHostRedirect(req('https://www.manicbot.com/blog?lang=pl'))).toEqual({
      to: 'https://manicbot.com/blog?lang=pl',
      status: 301,
    });
  });

  it('301s http apex → https apex', () => {
    expect(canonicalHostRedirect(req('http://manicbot.com/rules'))).toEqual({
      to: 'https://manicbot.com/rules',
      status: 301,
    });
  });

  it('301s http www → https apex (both wrong at once)', () => {
    expect(canonicalHostRedirect(req('http://www.manicbot.com/pricing'))).toEqual({
      to: 'https://manicbot.com/pricing',
      status: 301,
    });
  });

  it('trusts the CF-Visitor header over url.protocol when present', () => {
    // Behind Cloudflare the Worker can see https in request.url even for an
    // http client; CF-Visitor is the source of truth.
    const r = req('https://manicbot.com/', {
      headers: { 'cf-visitor': '{"scheme":"http"}' },
    });
    expect(canonicalHostRedirect(r)).toEqual({ to: 'https://manicbot.com/', status: 301 });
  });

  it('does NOT redirect the already-canonical apex https (no loop)', () => {
    expect(canonicalHostRedirect(req('https://manicbot.com/'))).toBeNull();
    expect(canonicalHostRedirect(req('https://manicbot.com/blog/x?y=1'))).toBeNull();
  });

  it('does NOT redirect non-canonical hosts (dev / preview / pages.dev)', () => {
    expect(canonicalHostRedirect(req('http://localhost:8787/'))).toBeNull();
    expect(canonicalHostRedirect(req('https://admin-app-3nc.pages.dev/login'))).toBeNull();
    expect(canonicalHostRedirect(req('http://127.0.0.1/'))).toBeNull();
  });

  it('does NOT redirect non-GET/HEAD methods (never rewrite a POST body)', () => {
    expect(canonicalHostRedirect(req('http://manicbot.com/api/track', { method: 'POST' }))).toBeNull();
    expect(canonicalHostRedirect(req('https://www.manicbot.com/webhook/x', { method: 'POST' }))).toBeNull();
  });

  it('handles a malformed CF-Visitor header without throwing', () => {
    const r = req('https://www.manicbot.com/', { headers: { 'cf-visitor': 'not-json' } });
    expect(canonicalHostRedirect(r)).toEqual({ to: 'https://manicbot.com/', status: 301 });
  });
});

describe('worker.fetch — canonical host/scheme 301', () => {
  // Minimal env satisfying validateSecurityConfig; the redirect short-circuits
  // before any binding/proxy use, so no D1/KV is needed.
  const env = { ALLOW_PLAINTEXT_TOKENS: '1', ADMIN_APP_URL: 'https://admin.example' };
  const ctx = { waitUntil() {} };

  it('GET https://www → 301 https apex (absolute Location)', async () => {
    const res = await workerDefault.fetch(req('https://www.manicbot.com/pricing'), env, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://manicbot.com/pricing');
  });

  it('HEAD http apex → 301 https apex (crawlers/monitors must not see a 200 dupe)', async () => {
    const res = await workerDefault.fetch(req('http://manicbot.com/', { method: 'HEAD' }), env, ctx);
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://manicbot.com/');
  });

  it('GET https apex is NOT redirected (falls through to normal routing)', async () => {
    // robots.txt is served inline by the Worker, so the canonical apex request
    // must reach it (200), proving the host redirect did not fire.
    const res = await workerDefault.fetch(req('https://manicbot.com/robots.txt'), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Location')).toBeNull();
  });
});
