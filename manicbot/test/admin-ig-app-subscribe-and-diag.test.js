/**
 * Tests for the two no-auth diagnostic/recovery endpoints:
 *   • POST /admin/ig-app-subscribe — App-level re-register webhook
 *     for object=instagram. Uses APP_ID|APP_SECRET App Access Token.
 *   • POST /admin/ig-diag — read-only triage: validates the stored
 *     IG token, reads Page subscribed_apps, lists App subscriptions,
 *     optional outbound test send.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

const mocks = vi.hoisted(() => ({
  decryptTokenWithFallback: vi.fn(),
}));
vi.mock('../src/utils/security.js', async () => {
  const actual = await vi.importActual('../src/utils/security.js');
  return { ...actual, decryptTokenWithFallback: mocks.decryptTokenWithFallback };
});

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const APP_ID = '1568224577592551';
const APP_SECRET = 'app-secret-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
const ENC_KEY = 'k'.repeat(32);
const ADMIN_KEY = 'test-admin-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function call(path, env, body = {}) {
  const finalEnv = { ADMIN_KEY, ...env };
  const req = new Request(`https://manicbot.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return tryAdminKeyRoutes(req, finalEnv, new URL(req.url));
}

describe('POST /admin/ig-app-subscribe', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  it('503 without META_APP_ID/SECRET', async () => {
    const res = await call('/admin/ig-app-subscribe', {});
    expect(res?.status).toBe(503);
  });

  it('posts (re)subscription for object=instagram with App Token', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))  // GET before
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))  // POST
      .mockResolvedValueOnce(new Response(JSON.stringify({  // GET after
        data: [{ object: 'instagram', callback_url: 'https://manicbot.com/webhook/ig', active: true }],
      }), { status: 200 }));

    const env = {
      META_APP_ID: APP_ID,
      META_APP_SECRET: APP_SECRET,
      META_VERIFY_TOKEN_IG: 'verify123',
      APP_BASE_URL: 'https://manicbot.com',
    };
    const res = await call('/admin/ig-app-subscribe', env);
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.callbackUrl).toBe('https://manicbot.com/webhook/ig');
    expect(body.finalList.data[0].object).toBe('instagram');

    // Verify POST used App Access Token format APP_ID|APP_SECRET.
    const postCall = fetchSpy.mock.calls.find(c => c[1]?.method === 'POST');
    expect(postCall).toBeTruthy();
    const postBody = postCall[1].body;
    const params = postBody instanceof URLSearchParams ? postBody : new URLSearchParams(String(postBody));
    expect(params.get('object')).toBe('instagram');
    expect(params.get('callback_url')).toBe('https://manicbot.com/webhook/ig');
    expect(params.get('verify_token')).toBe('verify123');
    expect(params.get('fields')).toContain('messages');
    expect(params.get('access_token')).toBe(`${APP_ID}|${APP_SECRET}`);
  });
});

describe('POST /admin/ig-diag', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.decryptTokenWithFallback.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  function makeEnv(row, extra = {}) {
    return {
      BOT_ENCRYPTION_KEY: ENC_KEY,
      META_APP_ID: APP_ID,
      META_APP_SECRET: APP_SECRET,
      DB: {
        prepare() {
          return {
            bind() { return this; },
            async first() { return row; },
            async run() { return { success: true }; },
            async all() { return { results: [] }; },
          };
        },
      },
      ...extra,
    };
  }

  it('500 when no encryption key', async () => {
    const env = makeEnv({ page_id: '1', token_encrypted: 'enc' });
    delete env.BOT_ENCRYPTION_KEY;
    const res = await call('/admin/ig-diag', env, { tenantId: 't_1' });
    expect(res?.status).toBe(503);
  });

  it('404 when tenant has no IG channel', async () => {
    const res = await call('/admin/ig-diag', makeEnv(null), { tenantId: 't_nope' });
    expect(res?.status).toBe(404);
  });

  it('500 when token decrypt fails', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: null, usedOldKey: false });
    const res = await call('/admin/ig-diag', makeEnv({
      page_id: '12345', token_encrypted: 'v1$dead',
    }), { tenantId: 't_1' });
    expect(res?.status).toBe(500);
  });

  it('happy path: returns me + subscribed_apps + app subscriptions, NO outbound test when psid omitted', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: 'good_token', usedOldKey: false });
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345', name: 'ManicBot Page' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: APP_ID, subscribed_fields: ['messages'] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ object: 'instagram', active: true }] }), { status: 200 }));

    const res = await call('/admin/ig-diag', makeEnv({
      page_id: '12345', token_encrypted: 'v1$good',
    }), { tenantId: 't_1' });
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.pageId).toBe('12345');
    expect(body.me.ok).toBe(true);
    expect(body.me.name).toBe('ManicBot Page');
    expect(body.subscribedApps.data[0].subscribed_fields).toContain('messages');
    expect(body.appSubscriptions.data[0].object).toBe('instagram');
    expect(body.testSend).toBeUndefined();  // no psid → no outbound
  });

  it('triggers outbound test send when psid provided', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: 'good_token', usedOldKey: false });
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '12345' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message_id: 'm_xyz' }), { status: 200 }));

    const res = await call('/admin/ig-diag', makeEnv({
      page_id: '12345', token_encrypted: 'v1$good',
    }), { tenantId: 't_1', psid: '1441501754119698' });
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.testSend).toBeDefined();
    expect(body.testSend.ok).toBe(true);

    const sendCall = fetchSpy.mock.calls.find(c => String(c[0]).includes('/me/messages'));
    expect(sendCall).toBeTruthy();
    expect(JSON.parse(sendCall[1].body).recipient.id).toBe('1441501754119698');
  });
});
