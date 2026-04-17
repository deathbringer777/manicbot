import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));
vi.mock('../src/utils/audit.js', () => ({
  audit: vi.fn(async () => {}),
}));

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'a'.repeat(48);

function makeEnv() {
  const upserts = [];
  const env = {
    ADMIN_KEY,
    DB: {
      prepare(sql) {
        return {
          bind(...params) {
            return {
              async run() {
                upserts.push({ sql, params });
                return { success: true };
              },
            };
          },
        };
      },
    },
  };
  return { env, upserts };
}

function makeRequest({ method = 'POST', path = '/admin/web-user', body, auth = `Bearer ${ADMIN_KEY}` } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (auth) headers.set('Authorization', auth);
  return new Request(`https://manicbot.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /admin/web-user — #S1 privilege escalation guard', () => {
  let env, upserts;

  beforeEach(() => {
    ({ env, upserts } = makeEnv());
  });

  it('rejects role=system_admin with 400 invalid_role and does NOT write to DB', async () => {
    const req = makeRequest({
      body: { email: 'attacker@evil.com', password: 'hunter2hunter2', role: 'system_admin' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res).not.toBeNull();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_role');
    expect(body.allowed).toContain('tenant_owner');
    expect(body.allowed).not.toContain('system_admin');
    expect(upserts).toHaveLength(0);
  });

  it('rejects role=admin (legacy spelling) with 400', async () => {
    const req = makeRequest({
      body: { email: 'a@b.com', password: 'hunter2hunter2', role: 'admin' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('rejects arbitrary role like role=root with 400', async () => {
    const req = makeRequest({
      body: { email: 'a@b.com', password: 'hunter2hunter2', role: 'root' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('accepts role=tenant_owner (allowlisted)', async () => {
    const req = makeRequest({
      body: { email: 'owner@salon.com', password: 'hunter2hunter2', role: 'tenant_owner', tenantId: 't_1' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.role).toBe('tenant_owner');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].params).toContain('tenant_owner');
  });

  it('accepts role=support and role=technical_support', async () => {
    for (const role of ['support', 'technical_support']) {
      ({ env, upserts } = makeEnv());
      const req = makeRequest({
        body: { email: `${role}@manicbot.com`, password: 'hunter2hunter2', role },
      });
      const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
      expect(res.status, `role=${role}`).toBe(200);
      expect(upserts).toHaveLength(1);
    }
  });

  it('accepts role=master', async () => {
    const req = makeRequest({
      body: { email: 'm@s.com', password: 'hunter2hunter2', role: 'master', tenantId: 't_1' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
  });

  it('defaults role to tenant_owner when omitted', async () => {
    const req = makeRequest({
      body: { email: 'o@s.com', password: 'hunter2hunter2' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('tenant_owner');
  });

  it('rejects requests without ADMIN_KEY (Bearer)', async () => {
    const req = makeRequest({
      auth: null,
      body: { email: 'a@b.com', password: 'hunter2hunter2', role: 'tenant_owner' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it('rejects requests with wrong ADMIN_KEY', async () => {
    const req = makeRequest({
      auth: `Bearer ${'b'.repeat(48)}`,
      body: { email: 'a@b.com', password: 'hunter2hunter2', role: 'tenant_owner' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it('accepts ADMIN_KEY via legacy ?key= query string (back-compat)', async () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const req = new Request(`https://manicbot.com/admin/web-user?key=${ADMIN_KEY}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'q@s.com', password: 'hunter2hunter2', role: 'tenant_owner' }),
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
  });

  it('rejects empty/missing email or password', async () => {
    const req = makeRequest({ body: { role: 'tenant_owner' } });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it('rejects password shorter than 8 chars', async () => {
    const req = makeRequest({
      body: { email: 'a@b.com', password: 'short', role: 'tenant_owner' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });
});
