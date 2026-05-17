/**
 * `addSecurityHeaders` is a *floor*, not an overwriter.
 *
 * The Worker proxies several admin-app paths to Cloudflare Pages. The
 * admin-app middleware sets its own security headers per-route (e.g.
 * `X-Frame-Options: SAMEORIGIN` for `/salon/{slug}/chat` so the salon
 * dashboard can embed the chat preview iframe; longer HSTS with `preload`).
 *
 * `addSecurityHeaders` wraps the proxied response. It used to call
 * `h.set(...)` unconditionally for every header, which clobbered the
 * admin-app's choices — breaking the chat preview iframe with
 * `X-Frame-Options: DENY` and downgrading HSTS.
 *
 * The contract verified here: if the upstream response already carries a
 * security header, the Worker leaves it alone. If it doesn't, the Worker
 * fills in the strict default.
 */
import { describe, it, expect } from 'vitest';
import { addSecurityHeaders } from '../src/worker.js';

function mkResp(headers) {
  return new Response('ok', { status: 200, headers });
}

describe('addSecurityHeaders — preserves admin-app middleware choices', () => {
  it('preserves SAMEORIGIN X-Frame-Options from upstream (chat iframe path)', () => {
    const upstream = mkResp({ 'X-Frame-Options': 'SAMEORIGIN' });
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('falls back to DENY when upstream sets no X-Frame-Options', () => {
    const upstream = mkResp({});
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('preserves the longer HSTS value from upstream (admin-app 2y + preload)', () => {
    const upstream = mkResp({
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    });
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
  });

  it('falls back to the Worker default HSTS when upstream sets none', () => {
    const upstream = mkResp({});
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('preserves admin-app CSP (already-correct behaviour — regression guard)', () => {
    const upstreamCsp = "default-src 'self'; frame-ancestors 'self'; script-src 'self' 'nonce-abc123'";
    const upstream = mkResp({ 'Content-Security-Policy': upstreamCsp });
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('Content-Security-Policy')).toBe(upstreamCsp);
  });

  it('fills in the strict Worker CSP when upstream sets none', () => {
    const upstream = mkResp({});
    const out = addSecurityHeaders(upstream);
    const csp = out.headers.get('Content-Security-Policy') || '';
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/default-src 'self'/);
  });

  it('preserves admin-app Cross-Origin-Resource-Policy if it set one', () => {
    // Admin-app middleware sets `Cross-Origin-Resource-Policy: same-origin`.
    // The Worker default does not set it at all today, but if a future
    // upstream sets it, we still don't want to clobber.
    const upstream = mkResp({ 'Cross-Origin-Resource-Policy': 'same-site' });
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site');
  });

  it('preserves all other security headers when upstream sets them', () => {
    const upstream = mkResp({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=()',
      'Cross-Origin-Opener-Policy': 'unsafe-none',
    });
    const out = addSecurityHeaders(upstream);
    expect(out.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(out.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(out.headers.get('Permissions-Policy')).toBe('geolocation=()');
    expect(out.headers.get('Cross-Origin-Opener-Policy')).toBe('unsafe-none');
  });
});
