import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'a'.repeat(48);

function makeEnv() {
  const store = new Map();
  const kv = {
    async get(k, type) {
      const v = store.get(k);
      if (!v) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
    _store: store,
  };
  return {
    env: {
      ADMIN_KEY,
      DB: {},
      MANICBOT: kv,
      APP_BASE_URL: 'https://manicbot.com',
      GOOGLE_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
      BOT_ENCRYPTION_KEY: 'x'.repeat(48),
    },
    kv,
  };
}

function makeRequest({ body, auth = `Bearer ${ADMIN_KEY}` } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (auth) headers.set('Authorization', auth);
  return new Request('https://manicbot.com/admin/google/oauth-url', {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /admin/google/oauth-url', () => {
  let env;
  beforeEach(() => { ({ env } = makeEnv()); });

  it('rejects without a valid admin key', async () => {
    const req = makeRequest({ body: { tenantId: 't1' }, auth: 'Bearer wrong' });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects missing tenantId', async () => {
    const req = makeRequest({ body: {} });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });

  it('returns a connectUrl and persists a web-mode session', async () => {
    const req = makeRequest({
      body: { tenantId: 't1', scope: 'tenant', returnUrl: 'https://manicbot.com/plugin/google-calendar' },
    });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.connectUrl).toMatch(/\/google\/connect\?session=/);
  });

  it('rejects invalid scope', async () => {
    const req = makeRequest({ body: { tenantId: 't1', scope: 'bogus' } });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(400);
  });
});
