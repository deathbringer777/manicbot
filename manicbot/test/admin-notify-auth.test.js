/**
 * /admin/notify dual-auth: accepts NOTIFY_TOKEN (low-priv, notify-only) OR
 * ADMIN_KEY (master). Locks the new contract so a future refactor cannot
 * silently broaden NOTIFY_TOKEN to other admin routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN = 'admin-key-with-at-least-thirty-two-characters-xx';
const NOTIFY = 'notify-token-with-at-least-thirty-two-chars-xxxxxx';

function makeEnv(overrides = {}) {
  return {
    ADMIN_KEY: ADMIN,
    NOTIFY_TOKEN: NOTIFY,
    NOTIFY_BOT_TOKEN: 'fake-bot-token',
    NOTIFY_CHAT_ID: '12345',
    ...overrides,
  };
}

function makeReq({ method = 'POST', path = '/admin/notify', auth, body = { text: 'hi' } } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (auth) headers.set('Authorization', `Bearer ${auth}`);
  return new Request(`https://manicbot.com${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

describe('/admin/notify dual-auth', () => {
  // Phase 2 cleanup: vi.stubGlobal + unstubAllGlobals isolates the fetch stub.
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
    ));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts NOTIFY_TOKEN Bearer', async () => {
    const req = makeReq({ auth: NOTIFY });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('accepts ADMIN_KEY Bearer (legacy)', async () => {
    const req = makeReq({ auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('rejects no Authorization header', async () => {
    const req = makeReq({});
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects wrong Bearer value', async () => {
    const req = makeReq({ auth: 'wrong-value-of-thirty-two-or-more-characters-xxxx' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects ?key= query param (legacy fallback removed)', async () => {
    const req = new Request(`https://manicbot.com/admin/notify?key=${NOTIFY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('NOTIFY_TOKEN does NOT unlock other admin routes (defense-in-depth)', async () => {
    // /admin/migrate uses isAdminKeyValid which only checks ADMIN_KEY.
    // NOTIFY_TOKEN must never escalate to admin operations.
    const req = new Request('https://manicbot.com/admin/migrate', {
      method: 'GET',
      headers: { Authorization: `Bearer ${NOTIFY}` },
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('falls through when NOTIFY_TOKEN unset but ADMIN_KEY still works', async () => {
    const req = makeReq({ auth: ADMIN });
    const env = makeEnv({ NOTIFY_TOKEN: undefined });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
  });

  it('returns 403 when neither token configured', async () => {
    const req = makeReq({ auth: NOTIFY });
    const env = makeEnv({ ADMIN_KEY: undefined, NOTIFY_TOKEN: undefined });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('rejects empty body', async () => {
    const req = makeReq({ auth: NOTIFY, body: { text: '   ' } });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('text_required');
  });

  it('returns 503 when bot token / chat id missing', async () => {
    const req = makeReq({ auth: NOTIFY });
    const env = makeEnv({ NOTIFY_BOT_TOKEN: undefined, BOT_TOKEN: undefined });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(503);
  });
});
