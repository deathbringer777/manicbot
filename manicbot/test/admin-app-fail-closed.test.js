/**
 * P2-8 — `requireAdminAppConfigured` must return 503 when ADMIN_APP_URL is
 * unset AND the request path is an admin-app route. Previously the proxy
 * silently fell through to a hardcoded preview URL.
 */
import { describe, it, expect } from 'vitest';
import { requireAdminAppConfigured } from '../src/worker.js';

function req(pathname, method = 'GET') {
  return new Request(`https://manicbot.com${pathname}`, { method });
}

describe('requireAdminAppConfigured (P2-8)', () => {
  it('returns 503 when ADMIN_APP_URL is unset and path is /dashboard', () => {
    const r = req('/dashboard');
    const url = new URL(r.url);
    const res = requireAdminAppConfigured(r, {}, url);
    expect(res).not.toBeNull();
    expect(res.status).toBe(503);
  });

  it('returns 503 when ADMIN_APP_URL is unset and path is /login', () => {
    const r = req('/login');
    const url = new URL(r.url);
    const res = requireAdminAppConfigured(r, {}, url);
    expect(res?.status).toBe(503);
  });

  it('returns 503 for /api/trpc/* paths when ADMIN_APP_URL is unset', () => {
    const r = req('/api/trpc/auth.getMyRole');
    const url = new URL(r.url);
    const res = requireAdminAppConfigured(r, {}, url);
    expect(res?.status).toBe(503);
  });

  it('returns null (pass-through) when ADMIN_APP_URL is configured', () => {
    const r = req('/dashboard');
    const url = new URL(r.url);
    const res = requireAdminAppConfigured(r, { ADMIN_APP_URL: 'https://admin.manicbot.com' }, url);
    expect(res).toBeNull();
  });

  it('returns null for non-admin-app paths regardless of ADMIN_APP_URL', () => {
    const r = req('/webhook/abc');
    const url = new URL(r.url);
    expect(requireAdminAppConfigured(r, {}, url)).toBeNull();
    expect(requireAdminAppConfigured(r, { ADMIN_APP_URL: 'https://x' }, url)).toBeNull();
  });

  it('returns null for /stripe/webhook (Worker-handled, not admin-app)', () => {
    const r = req('/stripe/webhook', 'POST');
    const url = new URL(r.url);
    expect(requireAdminAppConfigured(r, {}, url)).toBeNull();
  });
});
