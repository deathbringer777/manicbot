/**
 * Tests for POST /admin/ig-recover — emergency token recovery when the
 * encrypted IG token in D1 can no longer be decrypted (key rotated,
 * re-encrypt sweep didn't run). Self-gated: refuses unless current
 * token is genuinely dead AND the supplied FB User Token controls the
 * same Page that's stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

const mocks = vi.hoisted(() => ({
  decryptTokenWithFallback: vi.fn(),
  encryptToken: vi.fn(async (plain) => `v1$enc:${plain.slice(0, 16)}`),
}));
vi.mock('../src/utils/security.js', async () => {
  const actual = await vi.importActual('../src/utils/security.js');
  return {
    ...actual,
    decryptTokenWithFallback: mocks.decryptTokenWithFallback,
    encryptToken: mocks.encryptToken,
  };
});

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

const PAGE_ID = '1008301152373103';
const APP_SECRET = 'app-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const APP_ID = '1568224577592551';
const ENC_KEY = 'k'.repeat(32);

function call(env, body) {
  const req = new Request('https://manicbot.com/admin/ig-recover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return tryAdminKeyRoutes(req, env, new URL(req.url));
}

function makeEnv({ row, updates = [] } = {}) {
  return {
    BOT_ENCRYPTION_KEY: ENC_KEY,
    META_APP_ID: APP_ID,
    META_APP_SECRET: APP_SECRET,
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            if (sql.includes('SELECT id, page_id, token_encrypted FROM channel_configs')) {
              return row;
            }
            return null;
          },
          async run() { updates.push({ sql }); return { success: true }; },
        };
      },
    },
    _updates: updates,
  };
}

describe('POST /admin/ig-recover — gates', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.decryptTokenWithFallback.mockReset();
    mocks.encryptToken.mockClear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  it('400 without body params', async () => {
    const res = await call(makeEnv(), {});
    expect(res?.status).toBe(400);
  });

  it('503 without BOT_ENCRYPTION_KEY', async () => {
    const env = makeEnv();
    delete env.BOT_ENCRYPTION_KEY;
    const res = await call(env, { tenantId: 't_1', userToken: 'EAA' });
    expect(res?.status).toBe(503);
  });

  it('404 when tenant has no IG channel', async () => {
    const res = await call(makeEnv({ row: null }), {
      tenantId: 't_none', userToken: 'EAA',
    });
    expect(res?.status).toBe(404);
  });

  it('400 when channel row has no page_id', async () => {
    const res = await call(makeEnv({
      row: { id: 1, page_id: null, token_encrypted: 'enc' },
    }), { tenantId: 't_1', userToken: 'EAA' });
    expect(res?.status).toBe(400);
  });

  it('409 when current token IS healthy — refuses overwrite', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({
      plain: 'still-good', usedOldKey: false,
    });
    const res = await call(makeEnv({
      row: { id: 1, page_id: PAGE_ID, token_encrypted: 'v1$NEW:enc' },
    }), { tenantId: 't_1', userToken: 'EAA' });
    expect(res?.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('409 during key rotation (BOT_ENCRYPTION_KEY_OLD set) — recovery path disabled (A11)', async () => {
    // Mid-rotation a stale blob may still decrypt via the old key, so "dead
    // token" is not a reliable gate; force routine changes through the
    // ADMIN_KEY-gated /admin/ig-token instead of this self-gated path.
    mocks.decryptTokenWithFallback.mockResolvedValue({ plain: null, usedOldKey: false });
    fetchSpy.mockResolvedValue(new Response('{}', { status: 400 })); // must not be reached
    const env = makeEnv({ row: { id: 1, page_id: PAGE_ID, token_encrypted: 'v1$dead' } });
    env.BOT_ENCRYPTION_KEY_OLD = 'o'.repeat(32);
    const res = await call(env, { tenantId: 't_1', userToken: 'EAA' });
    expect(res?.status).toBe(409);
    // Refused before any decrypt or Graph call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('400 when Graph rejects the User Token', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: null, usedOldKey: false });
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { message: 'Invalid OAuth Access Token' } }),
      { status: 400 },
    ));
    const res = await call(makeEnv({
      row: { id: 1, page_id: PAGE_ID, token_encrypted: 'v1$dead' },
    }), { tenantId: 't_1', userToken: 'EAA_bad' });
    expect(res?.status).toBe(400);
  });

  it('403 when User Token does not control the stored Page', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: null, usedOldKey: false });
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ data: [{ id: '999', access_token: 'page_token_other' }] }),
      { status: 200 },
    ));
    const res = await call(makeEnv({
      row: { id: 1, page_id: PAGE_ID, token_encrypted: 'v1$dead' },
    }), { tenantId: 't_1', userToken: 'EAA_wrong_owner' });
    expect(res?.status).toBe(403);
    const body = await res.json();
    expect(body.pagesSeen).toContain('999');
  });

  it('happy path: dead token + matching page → exchange → store + subscribe', async () => {
    mocks.decryptTokenWithFallback.mockResolvedValueOnce({ plain: null, usedOldKey: false });
    fetchSpy
      // /me/accounts with original user token
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: PAGE_ID, access_token: 'short_page_token' }],
      }), { status: 200 }))
      // long-lived user token exchange
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'long_lived_user_token',
      }), { status: 200 }))
      // /me/accounts again with long-lived → page token
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: PAGE_ID, access_token: 'long_lived_page_token' }],
      }), { status: 200 }))
      // POST /{page_id}/subscribed_apps
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      // GET /{app_id}/subscriptions
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      // POST /{app_id}/subscriptions
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const env = makeEnv({
      row: { id: 7, page_id: PAGE_ID, token_encrypted: 'v1$dead_blob' },
    });
    const res = await call(env, { tenantId: 't_1', userToken: 'EAA_user_token' });
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pageId).toBe(PAGE_ID);
    expect(body.tokenStored).toBe(true);
    expect(body.subscribedApps.ok).toBe(true);

    // The long-lived Page Token must have been stored (it's the most durable).
    expect(mocks.encryptToken).toHaveBeenCalledWith(
      'long_lived_page_token', ENC_KEY, 'channel-token-v1',
    );
    // The subscribed_apps POST must have used the new page token.
    const subscribeCall = fetchSpy.mock.calls.find(c =>
      String(c[0]).includes('/subscribed_apps') && c[1]?.method === 'POST'
    );
    expect(subscribeCall).toBeTruthy();
    expect(String(subscribeCall[0])).toContain('access_token=long_lived_page_token');
    expect(String(subscribeCall[0])).toContain('messages');
  });
});
