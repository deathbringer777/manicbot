/**
 * #S11 — per-IP rate limit on /chat/init|send|poll.
 *
 * Uses the real D1-backed checkAndIncrement via the in-memory mock D1, so we
 * exercise the same code path as production (no monkey-patching the limiter).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

vi.mock('../src/handlers/inbound.js', () => ({
  handleInbound: vi.fn(async () => {}),
}));
vi.mock('../src/services/services.js', () => ({
  initServices: vi.fn(async () => {}),
}));
vi.mock('../src/utils/events.js', () => ({
  logEvent: vi.fn(async () => {}),
}));
vi.mock('../src/channels/resolver.js', async () => {
  const actual = await vi.importActual('../src/channels/resolver.js');
  return {
    ...actual,
    resolveTenantFromSlug: vi.fn(async () => ({ tenantId: 't_demo', channelConfig: {} })),
    buildChannelCtx: vi.fn(async (env, tenantId, channelConfig, channelAdapter) => {
      const ctx = { db: env.DB, kv: env.MANICBOT, tenantId, channelConfig, channel: channelAdapter };
      channelAdapter._ctx = ctx;
      return ctx;
    }),
  };
});

import { tryChatWeb } from '../src/http/chatWebHttp.js';

const TENANT_ROW = {
  id: 't_demo', name: 'Demo', display_name: 'Demo', logo: null, cover_photo: null,
  brand_palette: null, slug: 'demo', description: null, city: null, public_active: 1,
  // 0090 — gate column for `loadSalonBranding` is now `chat_enabled = 1`.
  chat_enabled: 1,
};

function makeEnv() {
  const db = createMockD1();
  // Pre-seed the tenant row so loadSalonBranding succeeds.
  db._getTable('tenants').push({ ...TENANT_ROW });
  return { DB: db, MANICBOT: makeMockKv(), ADMIN_CHAT_ID: null };
}

function req(method, path, { ip = '203.0.113.7', body } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': ip });
  if (body) headers.set('Content-Type', 'application/json');
  return new Request(`https://manicbot.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(env, request) {
  return tryChatWeb(request, env, new URL(request.url));
}

describe('#S11 chat rate limiting', () => {
  let env;
  beforeEach(() => { env = makeEnv(); });

  it('/chat/init returns 429 after 10 requests in the same window', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await call(env, req('POST', '/chat/init', { body: { slug: 'demo' } }));
      expect(r.status).toBe(200);
    }
    const eleventh = await call(env, req('POST', '/chat/init', { body: { slug: 'demo' } }));
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get('Retry-After')).toBeTruthy();
    const data = await eleventh.json();
    expect(data.error).toBe('rate_limited');
  });

  it('/chat/send returns 429 after 30 requests from the same IP', async () => {
    const sid = 'a'.repeat(32);
    const body = { slug: 'demo', sessionId: sid, text: 'hi' };
    for (let i = 0; i < 30; i++) {
      const r = await call(env, req('POST', '/chat/send', { body }));
      expect(r.status).toBe(200);
    }
    const blocked = await call(env, req('POST', '/chat/send', { body }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
  });

  it('/chat/poll returns 429 after 60 requests from the same IP', async () => {
    const sid = 'b'.repeat(32);
    const url = `/chat/poll?slug=demo&sessionId=${sid}&since=0`;
    for (let i = 0; i < 60; i++) {
      const r = await call(env, req('GET', url));
      expect(r.status).toBe(200);
    }
    const blocked = await call(env, req('GET', url));
    expect(blocked.status).toBe(429);
  });

  it('different IPs are tracked independently', async () => {
    for (let i = 0; i < 10; i++) {
      await call(env, req('POST', '/chat/init', { ip: '198.51.100.1', body: { slug: 'demo' } }));
    }
    // 11th from the original IP would be blocked, but a new IP is allowed.
    const fresh = await call(env, req('POST', '/chat/init', { ip: '198.51.100.2', body: { slug: 'demo' } }));
    expect(fresh.status).toBe(200);
  });

  it('x-forwarded-for rotation cannot mint fresh buckets (only cf-connecting-ip is trusted)', async () => {
    // A flooder with no cf-connecting-ip rotates a client-supplied
    // X-Forwarded-For each request. All must collapse to the single 'unknown'
    // bucket, so the 11th /chat/init is still blocked. (Old code keyed on XFF,
    // so each spoofed value got a fresh bucket and the limiter never tripped.)
    const spoof = (n) => new Request('https://manicbot.com/chat/init', {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json', 'x-forwarded-for': `10.0.0.${n}` }),
      body: JSON.stringify({ slug: 'demo' }),
    });
    for (let i = 0; i < 10; i++) {
      const r = await call(env, spoof(i));
      expect(r.status).toBe(200);
    }
    const blocked = await call(env, spoof(99));
    expect(blocked.status).toBe(429);
  });

  it('different actions on the same IP are counted separately', async () => {
    const ip = '198.51.100.5';
    for (let i = 0; i < 10; i++) {
      await call(env, req('POST', '/chat/init', { ip, body: { slug: 'demo' } }));
    }
    // init is exhausted, but send still has its own budget
    const send = await call(env, req('POST', '/chat/send', {
      ip, body: { slug: 'demo', sessionId: 'c'.repeat(32), text: 'hi' },
    }));
    expect(send.status).toBe(200);
  });

  it('429 response carries CORS headers so the browser can read it', async () => {
    for (let i = 0; i < 10; i++) {
      await call(env, req('POST', '/chat/init', { body: { slug: 'demo' } }));
    }
    const blocked = await call(env, req('POST', '/chat/init', { body: { slug: 'demo' } }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
