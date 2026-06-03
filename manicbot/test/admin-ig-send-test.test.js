/**
 * Tests for POST /admin/ig-send-test — diagnostic helper that sends a DM
 * from the tenant's bot to a PSID via InstagramAdapter.
 *
 * Endpoint contract:
 *   - 403 without Bearer ADMIN_KEY
 *   - 503 when BOT_ENCRYPTION_KEY missing
 *   - 400 on missing tenantId / psid
 *   - 404 when tenant has no active IG channel
 *   - 503 when token decrypt fails
 *   - 200 + sendRes pass-through when adapter succeeds (api='facebook' OR 'instagram_direct')
 *   - 200 + sendRes.error='outside_message_window' surfaces Meta's verdict
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

vi.mock('../src/channels/token-manager.js', () => ({
  getDecryptedToken: vi.fn(async (_ctx, _tenantId, _id, key) => key ? 'EAA_test_decrypted' : null),
}));

vi.mock('../src/utils/db.js', () => ({
  dbAll: vi.fn(async (_ctx, _sql, tenantId) => {
    if (tenantId === 't_with_ig') {
      return [{ id: 'cc_1', config: JSON.stringify({ page_id: 'pg_1', api: 'facebook' }), token_encrypted: 'enc' }];
    }
    if (tenantId === 't_ig_direct') {
      return [{ id: 'cc_2', config: JSON.stringify({ api: 'instagram_direct', ig_user_id: '17841' }), token_encrypted: 'enc' }];
    }
    return [];
  }),
  dbRun: vi.fn(async () => ({ success: true })),
  dbGet: vi.fn(async () => null),
}));

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const ADMIN_KEY = 'k_admin_'.repeat(4);
const ENC_KEY = 'e'.repeat(32);

function makeReq(body, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
  return new Request('https://manicbot.com/admin/ig-send-test', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

function makeEnv() {
  return {
    ADMIN_KEY,
    BOT_ENCRYPTION_KEY: ENC_KEY,
    DB: {},
    MANICBOT: {},
  };
}

function call(env, body, opts = {}) {
  const req = makeReq(body, opts);
  return tryAdminKeyRoutes(req, env, new URL(req.url));
}

describe('POST /admin/ig-send-test', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  it('403 without Bearer ADMIN_KEY', async () => {
    const res = await call(makeEnv(), { tenantId: 't_with_ig', psid: '123' }, { auth: false });
    expect(res?.status).toBe(403);
  });

  it('400 on missing tenantId / psid', async () => {
    const a = await call(makeEnv(), { psid: '123' });
    const b = await call(makeEnv(), { tenantId: 't_with_ig' });
    expect(a?.status).toBe(400);
    expect(b?.status).toBe(400);
  });

  it('503 when BOT_ENCRYPTION_KEY missing', async () => {
    const env = makeEnv();
    delete env.BOT_ENCRYPTION_KEY;
    const res = await call(env, { tenantId: 't_with_ig', psid: '123' });
    expect(res?.status).toBe(503);
  });

  it('404 when tenant has no active IG channel', async () => {
    const res = await call(makeEnv(), { tenantId: 't_ghost', psid: '123' });
    expect(res?.status).toBe(404);
    expect((await res.json()).error).toBe('no_active_ig_channel');
  });

  it('sends via legacy Page API (graph.facebook.com) for api=facebook channel', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message_id: 'mid_1' }), { status: 200 }));
    const res = await call(makeEnv(), {
      tenantId: 't_with_ig', psid: '17841437', text: 'hello',
    });
    expect(res?.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.api).toBe('facebook');
    expect(fetchSpy.mock.calls[0][0].toString()).toContain('graph.facebook.com');
    expect(fetchSpy.mock.calls[0][0].toString()).toContain('/pg_1/messages');
  });

  it('sends via instagram_direct (graph.instagram.com /me/messages) when configured', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message_id: 'mid_2' }), { status: 200 }));
    const res = await call(makeEnv(), {
      tenantId: 't_ig_direct', psid: '17841437',
    });
    expect(res?.status).toBe(200);
    const json = await res.json();
    expect(json.api).toBe('instagram_direct');
    const sentUrl = fetchSpy.mock.calls[0][0].toString();
    expect(sentUrl).toContain('graph.instagram.com');
    expect(sentUrl).toContain('/me/messages');
  });

  it('uses default test message body when text is omitted', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ message_id: 'mid' }), { status: 200 }));
    await call(makeEnv(), { tenantId: 't_with_ig', psid: '17841437' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message.text).toMatch(/test message|тест/i);
  });

  it('surfaces Meta error verbatim when send fails', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { message: 'User not in 24h window', code: 10 } }),
      { status: 400 },
    ));
    const res = await call(makeEnv(), { tenantId: 't_with_ig', psid: '17841437' });
    expect(res?.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.sendRes.ok).toBe(false);
  });
});
