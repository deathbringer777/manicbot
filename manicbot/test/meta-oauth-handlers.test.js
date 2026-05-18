/**
 * I/O tests for `services/meta-oauth.js`.
 *
 * Mocks:
 *   - KV (Map-backed in-memory)
 *   - D1 (minimal — getTenant + dbAll + createChannelConfig)
 *   - fetch (vi.spyOn route-by-route)
 *   - audit / logEvent (no-op)
 *
 * Coverage targets:
 *   • Bearer auth gates on start / consume / finalize
 *   • State + draft KV roundtrip (single-use semantics)
 *   • IG-direct: auto-finalize, IGAA token-type guard
 *   • FB-Login: picker path (multi-page), finalize with chosen page
 *   • IDOR: tenantId / webUserId on draft must match consume / finalize input
 *   • Callback: 410 on expired state, 302 on user denial, 302 on success
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

vi.mock('../src/tenant/storage.js', () => ({
  getTenant: vi.fn(async (_ctx, id) => (id === 't_real' ? { id: 't_real', name: 'Real Salon' } : null)),
}));

vi.mock('../src/utils/db.js', () => ({
  dbAll: vi.fn(async () => []),
  dbRun: vi.fn(async () => ({ success: true })),
  dbGet: vi.fn(async () => null),
}));

vi.mock('../src/channels/token-manager.js', () => ({
  createChannelConfig: vi.fn(async (_ctx, _tenantId, _type, _config, _token, _key) => 'cc_new'),
}));

import {
  handleMetaOAuthStart,
  handleMetaOAuthCallback,
  handleMetaOAuthConsume,
  handleMetaOAuthFinalize,
} from '../src/services/meta-oauth.js';
import { generateOauthState } from '../src/services/meta-oauth-logic.js';
import { createChannelConfig as createChannelConfigMock } from '../src/channels/token-manager.js';

const ADMIN_KEY = 'k_admin_'.repeat(4);
const ENC_KEY = 'e'.repeat(32);

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value, _opts) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function makeCtx(overrides = {}) {
  const kv = makeKv();
  return {
    ADMIN_KEY,
    BOT_ENCRYPTION_KEY: ENC_KEY,
    META_INSTAGRAM_APP_ID: '3756985564432185',
    META_INSTAGRAM_APP_SECRET: 'ig_app_secret',
    META_APP_ID: '1568224577592551',
    META_APP_SECRET: 'fb_app_secret',
    baseUrl: 'https://manicbot.com',
    db: { _stub: true },
    kv,
    globalKv: kv,
    ...overrides,
  };
}

function makeReq(path, { body, method = 'POST', auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
  return new Request(`https://manicbot.com${path}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
}

// ─── Start ──────────────────────────────────────────────────────────────────

describe('handleMetaOAuthStart', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('refuses calls without a Bearer ADMIN_KEY', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      auth: false,
      body: { provider: 'instagram', tenantId: 't_real', webUserId: 'u', returnTo: 'https://x' },
    }));
    expect(res.status).toBe(403);
  });

  it('400 on invalid provider', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      body: { provider: 'meta', tenantId: 't_real', webUserId: 'u', returnTo: 'https://x' },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_provider');
  });

  it('400 on missing tenantId / webUserId / bad returnTo', async () => {
    const ctx = makeCtx();
    for (const body of [
      { provider: 'instagram', webUserId: 'u', returnTo: 'https://x' },
      { provider: 'instagram', tenantId: 't_real', returnTo: 'https://x' },
      { provider: 'instagram', tenantId: 't_real', webUserId: 'u', returnTo: 'javascript:alert(1)' },
    ]) {
      const res = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', { body }));
      expect(res.status).toBe(400);
    }
  });

  it('404 when the tenant does not exist (no cross-tenant probing)', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      body: { provider: 'instagram', tenantId: 't_ghost', webUserId: 'u', returnTo: 'https://manicbot.com/dashboard' },
    }));
    expect(res.status).toBe(404);
  });

  it('503 when the provider env vars are missing', async () => {
    const ctx = makeCtx({ META_INSTAGRAM_APP_ID: '', META_INSTAGRAM_APP_SECRET: '' });
    const res = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      body: { provider: 'instagram', tenantId: 't_real', webUserId: 'u', returnTo: 'https://manicbot.com/x' },
    }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('oauth_not_configured');
  });

  it('returns an authorize URL and persists state to KV with 15min TTL', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      body: { provider: 'instagram', tenantId: 't_real', webUserId: 'u_42', returnTo: 'https://manicbot.com/dashboard?tab=channels' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.authUrl).toContain('https://www.instagram.com/oauth/authorize');
    expect(json.authUrl).toContain('client_id=3756985564432185');
    expect(json.authUrl).toContain('code_challenge_method=S256');
    expect(json.state).toMatch(/^[a-f0-9]{64}$/);

    // KV row exists for the state.
    expect(ctx.kv.store.has(`meta:oauth:state:${json.state}`)).toBe(true);
    const stored = JSON.parse(ctx.kv.store.get(`meta:oauth:state:${json.state}`));
    expect(stored.tenantId).toBe('t_real');
    expect(stored.webUserId).toBe('u_42');
    expect(stored.provider).toBe('instagram');
    expect(stored.pkceVerifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
});

// ─── Callback ───────────────────────────────────────────────────────────────

describe('handleMetaOAuthCallback', () => {
  beforeEach(() => vi.restoreAllMocks());

  function callbackUrl(provider, params) {
    const u = new URL(`https://manicbot.com/meta/${provider}/callback`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
  }

  it('410 when state is unknown / expired', async () => {
    const ctx = makeCtx();
    const url = callbackUrl('instagram', { code: 'AQD', state: 'a'.repeat(64) });
    const res = await handleMetaOAuthCallback(ctx, new Request(url), url, 'instagram');
    expect(res.status).toBe(410);
  });

  it('400 when state is malformed', async () => {
    const ctx = makeCtx();
    const url = callbackUrl('instagram', { code: 'AQD', state: 'short' });
    const res = await handleMetaOAuthCallback(ctx, new Request(url), url, 'instagram');
    expect(res.status).toBe(400);
  });

  it('302 with meta_ok=0 + meta_error when the user denies', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:state:${state}`, JSON.stringify({
      provider: 'instagram', tenantId: 't_real', webUserId: 'u',
      pkceVerifier: 'verifier', returnTo: 'https://manicbot.com/dash', createdAt: 1,
    }));
    const url = callbackUrl('instagram', { error: 'access_denied', error_description: 'User denied', state });
    const res = await handleMetaOAuthCallback(ctx, new Request(url), url, 'instagram');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location'));
    expect(loc.searchParams.get('meta_ok')).toBe('0');
    expect(loc.searchParams.get('meta_error')).toBe('access_denied');
    expect(loc.searchParams.get('meta_state')).toBe(state);
  });

  it('IG flow: exchanges code, stores draft, 302s with meta_ok=1', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:state:${state}`, JSON.stringify({
      provider: 'instagram', tenantId: 't_real', webUserId: 'u',
      pkceVerifier: 'verifier_x', returnTo: 'https://manicbot.com/dash', createdAt: 1,
    }));

    // 3-step IG exchange: short-lived → long-lived → /me.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ access_token: 'IGAA_short', user_id: '17841437' }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ access_token: 'IGAA_LONG_60d', expires_in: 5184000 }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ id: '17841437', username: 'manicbot_salon', account_type: 'BUSINESS' }), { status: 200 })));

    const url = callbackUrl('instagram', { code: 'AQD-ig', state });
    const res = await handleMetaOAuthCallback(ctx, new Request(url), url, 'instagram');
    expect(res.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const loc = new URL(res.headers.get('location'));
    expect(loc.searchParams.get('meta_ok')).toBe('1');
    expect(loc.searchParams.get('meta_state')).toBe(state);

    // Draft persisted, state burned.
    expect(ctx.kv.store.has(`meta:oauth:state:${state}`)).toBe(false);
    expect(ctx.kv.store.has(`meta:oauth:draft:${state}`)).toBe(true);
    const draft = JSON.parse(ctx.kv.store.get(`meta:oauth:draft:${state}`));
    expect(draft.provider).toBe('instagram');
    expect(draft.accessToken).toBe('IGAA_LONG_60d');
    expect(draft.igUserId).toBe('17841437');
    expect(draft.igUsername).toBe('manicbot_salon');
  });

  it('FB flow: short → long → /me → /me/accounts, draft carries Pages list', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:state:${state}`, JSON.stringify({
      provider: 'facebook', tenantId: 't_real', webUserId: 'u',
      pkceVerifier: 'verifier_y', returnTo: 'https://manicbot.com/dash', createdAt: 1,
    }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ access_token: 'EAA_short' }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ access_token: 'EAA_LONG_USER' }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ id: '100', name: 'Owner' }), { status: 200 })))
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        data: [
          { id: 'pg_1', name: 'Salon Page', access_token: 'EAA_PG_1', instagram_business_account: { id: 'igbiz_1', username: 'salon' } },
          { id: 'pg_2', name: 'Other Page', access_token: 'EAA_PG_2' },
        ],
      }), { status: 200 })));

    const url = callbackUrl('facebook', { code: 'AQD-fb', state });
    const res = await handleMetaOAuthCallback(ctx, new Request(url), url, 'facebook');
    expect(res.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const draft = JSON.parse(ctx.kv.store.get(`meta:oauth:draft:${state}`));
    expect(draft.provider).toBe('facebook');
    expect(draft.pages).toHaveLength(2);
    expect(draft.pages[0].accessToken).toBe('EAA_PG_1');
    expect(draft.pages[0].igBusinessId).toBe('igbiz_1');
    expect(draft.pages[1].igBusinessId).toBeNull();
  });
});

// ─── Consume ────────────────────────────────────────────────────────────────

describe('handleMetaOAuthConsume', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createChannelConfigMock.mockClear();
  });

  it('refuses without admin key', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      auth: false,
      body: { state: 'a'.repeat(64), tenantId: 't_real', webUserId: 'u' },
    }));
    expect(res.status).toBe(403);
  });

  it('400 on malformed state — no probing the KV namespace', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state: 'short', tenantId: 't_real', webUserId: 'u' },
    }));
    expect(res.status).toBe(400);
  });

  it('404 when no draft exists for the state', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state: 'a'.repeat(64), tenantId: 't_real', webUserId: 'u' },
    }));
    expect(res.status).toBe(404);
  });

  it('IDOR guard: draft tenantId mismatch returns 403', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'instagram',
      tenantId: 't_real', webUserId: 'u_owner',
      accessToken: 'IGAA_x', expiresAt: null,
      graphMe: { id: '1' }, igUserId: '1', igUsername: 'a', createdAt: 1,
    }));
    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_other', webUserId: 'u_owner' },
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('draft_tenant_mismatch');
    // Draft must NOT be consumed on a failed IDOR probe.
    expect(ctx.kv.store.has(`meta:oauth:draft:${state}`)).toBe(true);
  });

  it('IDOR guard: draft webUserId mismatch returns 403', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'instagram',
      tenantId: 't_real', webUserId: 'u_owner',
      accessToken: 'IGAA_x', expiresAt: null,
      graphMe: { id: '1' }, igUserId: '1', igUsername: 'a', createdAt: 1,
    }));
    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_attacker' },
    }));
    expect(res.status).toBe(403);
  });

  it('IG-direct: auto-finalize creates channel + calls subscribe', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'instagram',
      tenantId: 't_real', webUserId: 'u_owner',
      accessToken: 'IGAA_LONG', expiresAt: null,
      graphMe: { id: '17841437' },
      igUserId: '17841437', igUsername: 'manicbot_salon', createdAt: 1,
    }));

    // Subscribe call.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_owner' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.autoFinalized).toBe(true);
    expect(json.channelConfigId).toBe('cc_new');
    expect(json.subscribed).toBe(true);

    // createChannelConfig was called with api='instagram_direct'.
    expect(createChannelConfigMock).toHaveBeenCalledTimes(1);
    const args = createChannelConfigMock.mock.calls[0];
    const configObj = args[3];
    expect(configObj.api).toBe('instagram_direct');
    expect(configObj.ig_user_id).toBe('17841437');

    // Subscribe hit graph.instagram.com.
    expect(fetchSpy.mock.calls[0][0].toString()).toContain('graph.instagram.com');

    // Draft was deleted (single-use).
    expect(ctx.kv.store.has(`meta:oauth:draft:${state}`)).toBe(false);
  });

  it('FB multi-page: returns picker payload without persisting', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook',
      tenantId: 't_real', webUserId: 'u_owner',
      accessToken: 'EAA_USER', expiresAt: null,
      graphMe: { id: '100', name: 'Owner' },
      pages: [
        { id: 'pg_1', name: 'Salon Page', accessToken: 'EAA_PG_1', igBusinessId: 'igbiz_1', igUsername: 'salon' },
        { id: 'pg_2', name: 'Other Page', accessToken: 'EAA_PG_2', igBusinessId: null, igUsername: null },
      ],
      createdAt: 1,
    }));

    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_owner' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.autoFinalized).toBe(false);
    expect(json.pages).toHaveLength(2);
    // Picker payload must NOT leak Page tokens to the browser.
    expect(JSON.stringify(json.pages)).not.toContain('EAA_PG_1');
    expect(json.pages[0].igBusinessId).toBe('igbiz_1');
    // Draft is preserved for the subsequent finalize call.
    expect(ctx.kv.store.has(`meta:oauth:draft:${state}`)).toBe(true);
    // No channel created.
    expect(createChannelConfigMock).not.toHaveBeenCalled();
  });

  it('FB single-IG-linked-page: auto-finalize without picker', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook',
      tenantId: 't_real', webUserId: 'u_owner',
      accessToken: 'EAA_USER', expiresAt: null,
      graphMe: { id: '100', name: 'Owner' },
      pages: [
        { id: 'pg_solo', name: 'Solo Page', accessToken: 'EAA_PG_SOLO', igBusinessId: 'igbiz_s', igUsername: 'salon' },
      ],
      createdAt: 1,
    }));

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_owner' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.autoFinalized).toBe(true);
    expect(json.identity.pageId).toBe('pg_solo');
    expect(createChannelConfigMock).toHaveBeenCalledTimes(1);
    const configObj = createChannelConfigMock.mock.calls[0][3];
    expect(configObj.api).toBe('facebook');
    expect(configObj.page_id).toBe('pg_solo');
  });
});

// ─── Finalize (multi-page picker) ───────────────────────────────────────────

describe('handleMetaOAuthFinalize', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createChannelConfigMock.mockClear();
  });

  it('refuses without admin key', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthFinalize(ctx, makeReq('/meta/oauth/finalize', {
      auth: false,
      body: { state: 'a'.repeat(64), tenantId: 't_real', webUserId: 'u', pageId: 'pg' },
    }));
    expect(res.status).toBe(403);
  });

  it('400 on missing pageId', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook', tenantId: 't_real', webUserId: 'u',
      pages: [], createdAt: 1, accessToken: 'EAA',
    }));
    const res = await handleMetaOAuthFinalize(ctx, makeReq('/meta/oauth/finalize', {
      body: { state, tenantId: 't_real', webUserId: 'u' },
    }));
    expect(res.status).toBe(400);
  });

  it('IDOR guard on finalize too', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook', tenantId: 't_real', webUserId: 'u',
      pages: [{ id: 'pg', name: 'P', accessToken: 'EAA_P', igBusinessId: 'ig' }],
      createdAt: 1, accessToken: 'EAA',
    }));
    const res = await handleMetaOAuthFinalize(ctx, makeReq('/meta/oauth/finalize', {
      body: { state, tenantId: 't_other', webUserId: 'u', pageId: 'pg' },
    }));
    expect(res.status).toBe(403);
  });

  it('400 when pageId is not in the draft (attacker forges a Page)', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook', tenantId: 't_real', webUserId: 'u',
      pages: [{ id: 'pg_a', name: 'P', accessToken: 'EAA_PA', igBusinessId: 'ig' }],
      createdAt: 1, accessToken: 'EAA',
    }));
    const res = await handleMetaOAuthFinalize(ctx, makeReq('/meta/oauth/finalize', {
      body: { state, tenantId: 't_real', webUserId: 'u', pageId: 'pg_evil' },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('page_not_in_draft');
  });

  it('binds the chosen Page, creates channel, subscribes webhook', async () => {
    const ctx = makeCtx();
    const state = generateOauthState();
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook', tenantId: 't_real', webUserId: 'u',
      pages: [
        { id: 'pg_a', name: 'A', accessToken: 'EAA_PA', igBusinessId: 'ig_a', igUsername: 'a' },
        { id: 'pg_b', name: 'B', accessToken: 'EAA_PB', igBusinessId: 'ig_b', igUsername: 'b' },
      ],
      createdAt: 1, accessToken: 'EAA_USER',
    }));

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const res = await handleMetaOAuthFinalize(ctx, makeReq('/meta/oauth/finalize', {
      body: { state, tenantId: 't_real', webUserId: 'u', pageId: 'pg_b' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.channelConfigId).toBe('cc_new');

    expect(createChannelConfigMock).toHaveBeenCalledTimes(1);
    const configObj = createChannelConfigMock.mock.calls[0][3];
    expect(configObj.page_id).toBe('pg_b');
    expect(configObj.api).toBe('facebook');
    expect(configObj.instagram_business_id).toBe('ig_b');

    // Draft burned post-finalize.
    expect(ctx.kv.store.has(`meta:oauth:draft:${state}`)).toBe(false);
  });
});
