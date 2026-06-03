/**
 * T08 — `/salons` (bare directory index) must never dead-404.
 *
 * Root cause: the Worker proxy (isAdminAppPath) claims `/salons` as an
 * admin-app path, but the Next.js admin-app only implements the dynamic
 * `salons/[city]` segment — there is NO `salons/page.tsx` index route. So
 * a direct hit on bare `/salons` reaches Pages and returns the Next.js 404
 * (confirmed on prod). Every internal link / sitemap / robots / llms.txt
 * reference points to `/salons/{city-slug}` (which works), so bare `/salons`
 * is an orphan path with no owner.
 *
 * Fix: the Worker 301-redirects bare `/salons` → `/search` (the full salon
 * catalog index — the `[city]` page already breadcrumbs "Salony" to
 * `/search`). City pages `/salons/{slug}` are untouched and keep proxying.
 *
 * This file pins both the pure routing decision (`publicRedirectFor`) and
 * its consequence on the proxy allowlist contract.
 */
import { describe, it, expect } from 'vitest';
import { publicRedirectFor, isAdminAppPath } from '../src/http/adminAppProxy.js';
import workerDefault from '../src/worker.js';

describe('publicRedirectFor — bare /salons → /search (301)', () => {
  it('redirects bare /salons permanently to /search', () => {
    expect(publicRedirectFor('/salons')).toEqual({ to: '/search', status: 301 });
  });

  it('does NOT redirect city directory pages (they have a real route)', () => {
    expect(publicRedirectFor('/salons/warszawa')).toBeNull();
    expect(publicRedirectFor('/salons/gdansk')).toBeNull();
    expect(publicRedirectFor('/salons/wroclaw')).toBeNull();
  });

  it('does NOT redirect the catalog index itself or unrelated paths', () => {
    expect(publicRedirectFor('/search')).toBeNull();
    expect(publicRedirectFor('/salon/my-salon')).toBeNull();
    expect(publicRedirectFor('/')).toBeNull();
    expect(publicRedirectFor('/dashboard')).toBeNull();
    expect(publicRedirectFor('/salonsx')).toBeNull();
  });

  it('handles malformed input without throwing', () => {
    expect(publicRedirectFor(null)).toBeNull();
    expect(publicRedirectFor(undefined)).toBeNull();
    expect(publicRedirectFor('')).toBeNull();
  });

  it('city directory pages still proxy to admin-app (regression guard)', () => {
    // The redirect short-circuits BEFORE the proxy in the Worker, but the
    // dynamic city route must remain an admin-app path.
    expect(isAdminAppPath('/salons/warszawa')).toBe(true);
  });
});

describe('worker.fetch — bare /salons returns a real 301 to /search', () => {
  // Minimal env that satisfies validateSecurityConfig: encryption key escape
  // hatch on (dev), no Meta verify tokens, no ADMIN_KEY/NOTIFY_TOKEN. The
  // redirect short-circuits before any D1/KV/proxy, so no bindings are needed.
  const env = { ALLOW_PLAINTEXT_TOKENS: '1', ADMIN_APP_URL: 'https://admin.example' };
  const ctx = { waitUntil() {} };

  it('GET /salons → 301 Location /search (absolute, same origin)', async () => {
    const res = await workerDefault.fetch(
      new Request('https://manicbot.com/salons', { method: 'GET' }),
      env,
      ctx,
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://manicbot.com/search');
  });

  it('HEAD /salons → 301 (uptime monitors / crawlers must not see a 404)', async () => {
    const res = await workerDefault.fetch(
      new Request('https://manicbot.com/salons', { method: 'HEAD' }),
      env,
      ctx,
    );
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://manicbot.com/search');
  });
});
