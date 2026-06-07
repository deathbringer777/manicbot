/**
 * GET /admin/tenants-export — full tenant directory for the ThinkPad nightly sync.
 *
 * Security contract (locks the #413 hardening):
 *  - The route returns billing PII (email) for EVERY tenant, so it must require
 *    the high-privilege ADMIN_KEY — NOT the low-priv, widely-distributed
 *    NOTIFY_TOKEN. This is the same rule asserted in admin-notify-auth.test.js:
 *    "NOTIFY_TOKEN does NOT unlock other admin routes (defense-in-depth)."
 *    NOTIFY_TOKEN lives in the ThinkPad .env and in cloud-routine configs, so it
 *    is the likelier secret to leak; it must never be enough to dump the
 *    customer list.
 *  - No ?key= query-param fallback (it would leak the key into Cloudflare
 *    request logs / Referer / browser history).
 *  - Fail-closed: 403 when ADMIN_KEY is unset.
 */

import { describe, it, expect, vi } from 'vitest';
import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN = 'admin-key-with-at-least-thirty-two-characters-xx';
const NOTIFY = 'notify-token-with-at-least-thirty-two-chars-xxxxxx';

const TENANTS = [
  { id: 't_1', name: 'Алиса', salon: 'Nail Bar', email: 'a@example.com', plan: 'pro', billing_status: 'active', created_at: 200 },
  { id: 't_2', name: 'Боб', salon: 'Studio B', email: 'b@example.com', plan: 'start', billing_status: 'trialing', created_at: 100 },
];

function makeDb(tenants = TENANTS) {
  // dbAll(ctx, sql) → ctx.db.prepare(sql).bind(...).all() → { results: [...] }
  const runnable = {
    all: async () => ({ results: tenants }),
    first: async () => null,
    run: async () => ({ meta: { changes: 0 } }),
  };
  return { prepare: vi.fn(() => ({ bind: () => runnable, ...runnable })) };
}

function makeEnv(overrides = {}) {
  return { ADMIN_KEY: ADMIN, NOTIFY_TOKEN: NOTIFY, DB: makeDb(), ...overrides };
}

function makeReq({ method = 'GET', path = '/admin/tenants-export', auth, search = '' } = {}) {
  const headers = new Headers();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);
  return new Request(`https://manicbot.com${path}${search}`, { method, headers });
}

describe('GET /admin/tenants-export — auth (ADMIN_KEY only)', () => {
  it('accepts ADMIN_KEY Bearer and returns the tenant array', async () => {
    const req = makeReq({ auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      id: 't_1', name: 'Алиса', salon: 'Nail Bar', email: 'a@example.com',
      plan: 'pro', billing_status: 'active', created_at: 200,
    });
  });

  it('REJECTS NOTIFY_TOKEN — a notify-only token must not dump customer PII', async () => {
    const req = makeReq({ auth: NOTIFY });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects a request with no Authorization header', async () => {
    const req = makeReq({});
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects a wrong Bearer value', async () => {
    const req = makeReq({ auth: 'wrong-value-of-thirty-two-or-more-characters-xx' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects the ?key= query-param fallback (no log-leaking auth)', async () => {
    const req = makeReq({ auth: undefined, search: `?key=${ADMIN}` });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('fails closed (403) when ADMIN_KEY is unset', async () => {
    const req = makeReq({ auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, makeEnv({ ADMIN_KEY: undefined }), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('null-safes missing columns to empty strings', async () => {
    const env = makeEnv({ DB: makeDb([{ id: 't_x', created_at: 5 }]) });
    const req = makeReq({ auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    const data = await res.json();
    expect(data[0]).toEqual({
      id: 't_x', name: '', salon: '', email: '', plan: '', billing_status: '', created_at: 5,
    });
  });
});
