import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import {
  createWebOAuthSession,
  handleGoogleCallback,
} from '../src/services/google-calendar-oauth.js';

function makeKv() {
  const store = new Map();
  return {
    async get(key, type) {
      const raw = store.get(key);
      if (!raw) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, val) { store.set(key, val); },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

function baseCtx(extra = {}) {
  const ctx = makeCtx({ tenantId: 't_web' });
  const kv = makeKv();
  return {
    ...ctx,
    kv,
    globalKv: kv,
    APP_BASE_URL: 'https://manicbot.com',
    baseUrl: 'https://manicbot.com',
    GOOGLE_OAUTH_CLIENT_ID: 'cid',
    GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
    GOOGLE_OAUTH_REDIRECT_URI: 'https://manicbot.com/google/callback',
    BOT_ENCRYPTION_KEY: 'x'.repeat(48),
    ...extra,
  };
}

describe('createWebOAuthSession', () => {
  it('returns a connect URL and persists a web-mode session in KV', async () => {
    const ctx = baseCtx();
    const result = await createWebOAuthSession(ctx, {
      tenantId: 't_web',
      scope: 'tenant',
      returnUrl: 'https://manicbot.com/plugin/google-calendar',
    });
    expect(result.ok).toBe(true);
    expect(result.connectUrl).toMatch(/^https:\/\/manicbot\.com\/google\/connect\?session=/);
    const sessionKey = 'gcal:oauth:' + result.sessionId;
    const raw = await ctx.kv.get(sessionKey, 'json');
    expect(raw).toMatchObject({
      stage: 'oauth',
      mode: 'web',
      tenantId: 't_web',
      scope: 'tenant',
      returnUrl: 'https://manicbot.com/plugin/google-calendar',
    });
  });

  it('rejects without tenantId', async () => {
    const ctx = baseCtx();
    const result = await createWebOAuthSession(ctx, { tenantId: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects when OAuth credentials are missing', async () => {
    const ctx = baseCtx({ GOOGLE_OAUTH_CLIENT_ID: '' });
    const result = await createWebOAuthSession(ctx, { tenantId: 't_web' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('google_oauth_not_configured');
  });
});

describe('handleGoogleCallback web mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-selects primary calendar and redirects to returnUrl', async () => {
    const ctx = baseCtx();
    const { sessionId } = await createWebOAuthSession(ctx, {
      tenantId: 't_web',
      scope: 'tenant',
      returnUrl: 'https://manicbot.com/plugin/google-calendar',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/calendarList')) {
        return new Response(
          JSON.stringify({
            items: [
              { id: 'other@example.com', summary: 'Other', accessRole: 'reader' },
              { id: 'owner@example.com', summary: 'Work', primary: true, accessRole: 'owner' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (u.includes('/events')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      // watch / stop / anything else -> empty OK
      return new Response('{}', { status: 200 });
    });

    const url = new URL(`https://manicbot.com/google/callback?code=thecode&state=${sessionId}`);
    const resp = await handleGoogleCallback(ctx, url);

    expect(resp.status).toBe(302);
    const loc = resp.headers.get('Location') || '';
    expect(loc).toContain('/plugin/google-calendar');
    expect(loc).toContain('connected=1');

    // Session cleared
    const raw = await ctx.kv.get('gcal:oauth:' + sessionId, 'json');
    expect(raw).toBeNull();
    fetchSpy.mockRestore();
  });

  it('redirects with gcal_error=no_writable_calendar when no writable calendars exist', async () => {
    const ctx = baseCtx();
    const { sessionId } = await createWebOAuthSession(ctx, {
      tenantId: 't_web',
      scope: 'tenant',
      returnUrl: 'https://manicbot.com/plugin/google-calendar',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({ access_token: 'at', refresh_token: 'rt' }),
          { status: 200 },
        );
      }
      if (u.includes('/calendarList')) {
        return new Response(
          JSON.stringify({ items: [{ id: 'ro@example.com', accessRole: 'reader' }] }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    });

    const url = new URL(`https://manicbot.com/google/callback?code=c&state=${sessionId}`);
    const resp = await handleGoogleCallback(ctx, url);
    expect(resp.status).toBe(302);
    expect(resp.headers.get('Location') || '').toContain('gcal_error=no_writable_calendar');
    fetchSpy.mockRestore();
  });
});
