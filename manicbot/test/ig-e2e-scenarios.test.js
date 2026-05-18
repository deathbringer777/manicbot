/**
 * End-to-end IG integration scenarios — exercise the full PR 1/2/3
 * surface together so a regression in any single module surfaces here
 * rather than at deploy time.
 *
 * Each scenario mocks fetch at every Graph endpoint and drives the
 * Worker entry points (`/meta/oauth/*`, `/admin/ig-send-test`,
 * `captureError + getInstagramHealth equivalents`) like an integration
 * test, but stays in-process so no network is required.
 *
 * Scenarios:
 *   1. Happy path — fresh OAuth → channel persisted → test message sends.
 *   2. Recovery — broken token causes captureError → owner re-auths →
 *      new channel works.
 *   3. Edge: state expired between callback and consume → 410 surfaces
 *      the user-friendly retry hint.
 *   4. Edge: FB-Login with zero IG-linked Pages → picker payload is
 *      empty, can't auto-finalize, finalize on a Page id absent from
 *      the draft is refused.
 *   5. Edge: webhook signature mismatch logs a META_WEBHOOK_SIGNATURE_MISMATCH
 *      slug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

vi.mock('../src/tenant/storage.js', () => ({
  getTenant: vi.fn(async (_ctx, id) => (id === 't_real' ? { id: 't_real', name: 'Real Salon' } : null)),
}));

const dbAllMock = vi.fn();
vi.mock('../src/utils/db.js', () => ({
  dbAll: (...args) => dbAllMock(...args),
  dbRun: vi.fn(async () => ({ success: true })),
  dbGet: vi.fn(async () => null),
}));

const createChannelConfigMock = vi.fn(async () => 'cc_oauth_new');
vi.mock('../src/channels/token-manager.js', () => ({
  createChannelConfig: (...args) => createChannelConfigMock(...args),
  getDecryptedToken: vi.fn(async (_ctx, _id, key) => key ? 'IGAA_LIVE_TOKEN' : null),
}));

import {
  handleMetaOAuthStart,
  handleMetaOAuthCallback,
  handleMetaOAuthConsume,
  handleMetaOAuthFinalize,
} from '../src/services/meta-oauth.js';
import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';
import { CHANNEL_ERROR_TYPE } from '../src/channels/error-types.js';

const ADMIN_KEY = 'k_admin_'.repeat(4);
const ENC_KEY = 'e'.repeat(32);

function makeKv() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, v); },
    async delete(k) { store.delete(k); },
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
    db: {
      prepare() {
        return {
          bind() {
            return {
              async first() { return null; },
              async run() { return { success: true }; },
              async all() { return { results: [] }; },
            };
          },
        };
      },
    },
    DB: { /* present for adminKeyHttp env guard */ },
    kv,
    globalKv: kv,
    ...overrides,
  };
}

function makeReq(path, { body, method = 'POST', auth = true, search = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
  return new Request(`https://manicbot.com${path}${search}`, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body),
  });
}

// ─── Scenario 1: Happy path ─────────────────────────────────────────────────

describe('IG E2E — happy path (fresh connect via IG-direct OAuth)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createChannelConfigMock.mockClear();
    createChannelConfigMock.mockResolvedValue('cc_oauth_new');
    dbAllMock.mockReset();
    // /admin/ig-channel-style + /admin/ig-send-test both query channel_configs.
    dbAllMock.mockImplementation(async (_ctx, sql, ...params) => {
      if (sql.includes("channel_type = 'instagram'")) {
        // 1st call from persistChannelFromDraft existence check → no row,
        // so the channel is freely created.
        // Subsequent calls (post-finalize, from ig-send-test) → return
        // the row we just created.
        const tenantId = params[0];
        if (tenantId === 't_real') {
          return scenarioContext.channelRowExists
            ? [{ id: 'cc_oauth_new', config: JSON.stringify({ api: 'instagram_direct', ig_user_id: '17841' }), token_encrypted: 'enc' }]
            : [];
        }
      }
      return [];
    });
  });

  const scenarioContext = { channelRowExists: false };

  it('start → callback → consume → channel created → send-test succeeds', async () => {
    const ctx = makeCtx();
    scenarioContext.channelRowExists = false;

    // ── Step 1: tRPC.metaOAuth.start → Worker /meta/oauth/start
    const startRes = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      body: { provider: 'instagram', tenantId: 't_real', webUserId: 'u_42', returnTo: 'https://manicbot.com/dashboard?tab=channels' },
    }));
    const startJson = await startRes.json();
    expect(startJson.ok).toBe(true);
    expect(startJson.authUrl).toContain('instagram.com/oauth/authorize');
    const state = startJson.state;
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(ctx.kv.store.has(`meta:oauth:state:${state}`)).toBe(true);

    // ── Step 2: Meta-initiated callback. Mock the 3-step IG code exchange.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'IGAA_short', user_id: '17841' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'IGAA_LONG', expires_in: 5184000 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '17841', username: 'manicbot_salon', account_type: 'BUSINESS' }), { status: 200 }));

    const callbackUrl = new URL(`https://manicbot.com/meta/instagram/callback?code=AQD_real_code&state=${state}`);
    const cbRes = await handleMetaOAuthCallback(ctx, new Request(callbackUrl), callbackUrl, 'instagram');
    expect(cbRes.status).toBe(302);
    const loc = new URL(cbRes.headers.get('location'));
    expect(loc.searchParams.get('meta_ok')).toBe('1');
    expect(loc.searchParams.get('meta_state')).toBe(state);
    // State burned; draft persisted.
    expect(ctx.kv.store.has(`meta:oauth:state:${state}`)).toBe(false);
    expect(ctx.kv.store.has(`meta:oauth:draft:${state}`)).toBe(true);

    // ── Step 3: consume → auto-finalize for IG-direct. Mock subscribe call.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const consumeRes = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_42' },
    }));
    const consumeJson = await consumeRes.json();
    expect(consumeJson.ok).toBe(true);
    expect(consumeJson.autoFinalized).toBe(true);
    expect(consumeJson.channelConfigId).toBe('cc_oauth_new');
    expect(consumeJson.subscribed).toBe(true);

    // createChannelConfig was called with the correct shape.
    expect(createChannelConfigMock).toHaveBeenCalledTimes(1);
    const [, tenantArg, , configObj] = createChannelConfigMock.mock.calls[0];
    expect(tenantArg).toBe('t_real');
    expect(configObj.api).toBe('instagram_direct');
    expect(configObj.ig_user_id).toBe('17841');

    // ── Step 4: /admin/ig-send-test → message sends to a real PSID.
    scenarioContext.channelRowExists = true;
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message_id: 'mid_e2e' }), { status: 200 }));

    const sendRes = await tryAdminKeyRoutes(makeReq('/admin/ig-send-test', {
      body: { tenantId: 't_real', psid: '17841437', text: 'E2E test message' },
    }), { ...ctx, DB: ctx.db }, new URL('https://manicbot.com/admin/ig-send-test'));
    expect(sendRes.status).toBe(200);
    const sendJson = await sendRes.json();
    expect(sendJson.ok).toBe(true);
    expect(sendJson.api).toBe('instagram_direct');
  });
});

// ─── Scenario 2: Recovery — broken token detected, reauth fixes it ─────────

describe('IG E2E — recovery path (broken token → reauth → fixed)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createChannelConfigMock.mockReset();
    createChannelConfigMock.mockResolvedValue('cc_oauth_recovered');
    dbAllMock.mockReset();
  });

  it('reauth flow creates a NEW row after the old one was hard-disconnected', async () => {
    const ctx = makeCtx();

    // The "broken" state was already surfaced to the operator via
    // IG_TOKEN_REJECTED in error_events. They hit "Переподключить" which
    // calls salon.disconnectChannel(mode='hard') in the admin-app — that
    // path is exercised by salon-channel-actions tests. Here we focus on
    // the next step: a fresh OAuth flow that lands a NEW row.

    // The disconnect already happened, so dbAll returns no IG row.
    dbAllMock.mockImplementation(async () => []);

    // Run the OAuth dance again.
    const startRes = await handleMetaOAuthStart(ctx, makeReq('/meta/oauth/start', {
      body: { provider: 'instagram', tenantId: 't_real', webUserId: 'u_42', returnTo: 'https://manicbot.com/dashboard' },
    }));
    const { state } = await startRes.json();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'IGAA_short2', user_id: '17841' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'IGAA_LONG2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '17841', username: 'salon' }), { status: 200 }));

    const cbUrl = new URL(`https://manicbot.com/meta/instagram/callback?code=NEW_CODE&state=${state}`);
    const cbRes = await handleMetaOAuthCallback(ctx, new Request(cbUrl), cbUrl, 'instagram');
    expect(cbRes.status).toBe(302);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    const consumeRes = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_42' },
    }));
    const json = await consumeRes.json();
    expect(json.ok).toBe(true);
    expect(json.channelConfigId).toBe('cc_oauth_recovered');
  });
});

// ─── Scenario 3: Expired state surfaces 410 ─────────────────────────────────

describe('IG E2E — state expired between callback and consume', () => {
  it('returns 410 from callback when state KV row TTL has lapsed', async () => {
    const ctx = makeCtx();
    // Simulate a state that was never put OR has expired (KV returns null).
    const callbackUrl = new URL(`https://manicbot.com/meta/instagram/callback?code=any&state=${'a'.repeat(64)}`);
    const res = await handleMetaOAuthCallback(ctx, new Request(callbackUrl), callbackUrl, 'instagram');
    expect(res.status).toBe(410);
  });

  it('returns 404 from consume when draft KV row has lapsed', async () => {
    const ctx = makeCtx();
    const res = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state: 'b'.repeat(64), tenantId: 't_real', webUserId: 'u' },
    }));
    expect(res.status).toBe(404);
  });
});

// ─── Scenario 4: FB-Login multi-Page, but none has IG linked ────────────────

describe('IG E2E — FB-Login flow with no IG-linked Pages', () => {
  it('returns picker payload with empty IG metadata; finalize refuses fake pageId', async () => {
    const ctx = makeCtx();

    // Skip the callback step and seed a draft directly with two Pages,
    // neither IG-linked. This is the realistic "tenant has a Business
    // Manager but never connected IG to a Page" scenario.
    const state = 'c'.repeat(64);
    ctx.kv.store.set(`meta:oauth:draft:${state}`, JSON.stringify({
      provider: 'facebook',
      tenantId: 't_real',
      webUserId: 'u_42',
      accessToken: 'EAA_USER',
      pages: [
        { id: 'pg_a', name: 'Personal Page', accessToken: 'EAA_PG_A', igBusinessId: null, igUsername: null },
        { id: 'pg_b', name: 'Another Page', accessToken: 'EAA_PG_B', igBusinessId: null, igUsername: null },
      ],
      graphMe: { id: '100', name: 'Owner' },
      createdAt: 1,
    }));

    const consumeRes = await handleMetaOAuthConsume(ctx, makeReq('/meta/oauth/consume', {
      body: { state, tenantId: 't_real', webUserId: 'u_42' },
    }));
    expect(consumeRes.status).toBe(200);
    const json = await consumeRes.json();
    // No IG-linked Page → can't auto-finalize → picker is shown but with
    // empty igBusinessId on every row → UI shows "no IG" hint.
    expect(json.autoFinalized).toBe(false);
    expect(json.pages.every(p => p.igBusinessId === null)).toBe(true);

    // Attacker tries to forge a pageId that wasn't in the draft.
    const fakeFinalize = await handleMetaOAuthFinalize(ctx, makeReq('/meta/oauth/finalize', {
      body: { state, tenantId: 't_real', webUserId: 'u_42', pageId: 'pg_attacker' },
    }));
    expect(fakeFinalize.status).toBe(400);
    expect((await fakeFinalize.json()).error).toBe('page_not_in_draft');
  });
});

// ─── Scenario 5: Webhook signature mismatch is stamped with the right slug ──

describe('IG E2E — webhook signature mismatch tags META_WEBHOOK_SIGNATURE_MISMATCH', () => {
  it('CHANNEL_ERROR_TYPE.META_WEBHOOK_SIGNATURE_MISMATCH equals the contract slug', () => {
    // metaWebhooksHttp.js passes this constant to captureError. The slug
    // value is part of the public contract with admin-app/getInstagramHealth
    // and the parity test. Pin it here as a smoke check.
    expect(CHANNEL_ERROR_TYPE.META_WEBHOOK_SIGNATURE_MISMATCH).toBe('channel.meta.signature_mismatch');
  });

  it('all 7 IG slugs are present and follow the channel.* convention', () => {
    const slugs = Object.values(CHANNEL_ERROR_TYPE);
    expect(slugs).toHaveLength(7);
    for (const s of slugs) {
      expect(s).toMatch(/^channel\./);
    }
  });
});
