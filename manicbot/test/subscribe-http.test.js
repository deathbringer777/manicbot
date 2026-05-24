/**
 * Unit + integration tests for /api/subscribe (newsletter ingest).
 *
 * The endpoint is the only public surface that writes to
 * `newsletter_subscribers`. The tests pin:
 *   * happy path → row in D1 + welcome dispatched exactly once
 *   * dedup → second submit doesn't double-INSERT or double-send
 *   * bad email → 400, no row
 *   * IP rate limit → 429 after SUBSCRIBE_RATE_LIMIT_MAX calls
 *   * body > 8 KB → 400
 *   * wrong method → 405
 *   * dispatch fires exactly once per new row
 *   * INTERNAL_API_TOKEN absent → graceful no-op, welcome_send_error stamped,
 *     subscribe still 202
 *
 * The handler uses fetch() for the internal call to admin-app, so we stub
 * globalThis.fetch via vi.stubGlobal for every test that asserts on the
 * dispatch side effect.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import {
  handleSubscribeRequest,
  dispatchWelcomeEmail,
  __test,
} from '../src/http/subscribeHttp.js';
import {
  parseSubscribePayload,
  buildSubscriberInsertParams,
  SUBSCRIBE_RATE_LIMIT_MAX,
} from '../src/http/subscribeHttpLogic.js';
import { dbGet, dbRun } from '../src/utils/db.js';

const ADMIN_APP_URL = 'https://admin-app.example';

function postBody(body, ip = '198.51.100.10') {
  return new Request('https://example.com/api/subscribe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
      'user-agent': 'vitest/0',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function buildEnv(ctx, overrides = {}) {
  return {
    DB: ctx.db,
    ADMIN_APP_URL,
    INTERNAL_API_TOKEN: 'test-internal-token-xxxxxxxxxxxxxxxxx',
    ...overrides,
  };
}

describe('parseSubscribePayload — schema validation', () => {
  it('accepts a well-formed payload with lang', () => {
    const r = parseSubscribePayload({ email: 'foo@bar.com', lang: 'ru' });
    expect(r.ok).toBe(true);
    expect(r.value.email).toBe('foo@bar.com');
    expect(r.value.lang).toBe('ru');
    expect(r.value.source).toBe('landing');
  });

  it('lowercases + trims the email', () => {
    const r = parseSubscribePayload({ email: '  USER@Example.COM ' });
    expect(r.ok).toBe(true);
    expect(r.value.email).toBe('user@example.com');
  });

  it('accepts the landing-form `locale` field and folds it to lang', () => {
    const r = parseSubscribePayload({ email: 'a@b.io', locale: 'PL' });
    expect(r.ok).toBe(true);
    expect(r.value.lang).toBe('pl');
  });

  it('drops an unsupported lang to null', () => {
    const r = parseSubscribePayload({ email: 'a@b.io', lang: 'de' });
    expect(r.ok).toBe(true);
    expect(r.value.lang).toBe(null);
  });

  it('rejects an obvious garbage email', () => {
    expect(parseSubscribePayload({ email: 'not-an-email' }).ok).toBe(false);
    expect(parseSubscribePayload({ email: '@nothing.io' }).ok).toBe(false);
    expect(parseSubscribePayload({ email: 'spaces in@email.io' }).ok).toBe(false);
  });

  it('rejects a missing payload', () => {
    expect(parseSubscribePayload(null).ok).toBe(false);
    expect(parseSubscribePayload('not-an-object').ok).toBe(false);
    expect(parseSubscribePayload([]).ok).toBe(false);
  });

  it('drops an unknown source to `landing`', () => {
    const r = parseSubscribePayload({ email: 'a@b.io', source: '<script>x' });
    expect(r.ok).toBe(true);
    expect(r.value.source).toBe('landing');
  });

  it('drops a malformed anonymous_id to null', () => {
    const r = parseSubscribePayload({ email: 'a@b.io', anonymousId: 'short' });
    expect(r.ok).toBe(true);
    expect(r.value.anonymousId).toBe(null);
  });
});

describe('handleSubscribeRequest — happy path', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts a row and returns 202', async () => {
    const ctx = makeCtx({ tenantId: 't_news_happy' });
    const env = buildEnv(ctx);
    const res = await handleSubscribeRequest(postBody({ email: 'Hello@Example.COM', locale: 'ru' }), env);
    expect(res.status).toBe(202);

    const row = await dbGet(
      ctx,
      'SELECT email, source, lang, welcome_sent_at FROM newsletter_subscribers WHERE email = ?',
      'hello@example.com',
    );
    expect(row?.email).toBe('hello@example.com');
    expect(row?.source).toBe('landing');
    expect(row?.lang).toBe('ru');
  });

  it('dispatches the welcome email exactly once per new row', async () => {
    const ctx = makeCtx({ tenantId: 't_news_once' });
    const env = buildEnv(ctx);
    await handleSubscribeRequest(postBody({ email: 'one@example.com' }), env);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${ADMIN_APP_URL}${__test.WELCOME_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toMatch(/^Bearer /);
    const parsed = JSON.parse(init.body);
    expect(parsed.email).toBe('one@example.com');
    // lang defaulted to 'en' when omitted on the wire.
    expect(parsed.lang).toBe('en');
  });
});

describe('handleSubscribeRequest — dedup', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a second submit for the same email does not double-INSERT or double-send', async () => {
    const ctx = makeCtx({ tenantId: 't_news_dedup' });
    const env = buildEnv(ctx);
    const first = await handleSubscribeRequest(postBody({ email: 'dup@example.com' }), env);
    expect(first.status).toBe(202);
    const second = await handleSubscribeRequest(postBody({ email: 'dup@example.com' }), env);
    expect(second.status).toBe(202);

    // Only one row.
    const rows = ctx.db._getTable('newsletter_subscribers');
    expect(rows.length).toBe(1);

    // Only one welcome dispatch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats case-insensitive emails as the same subscriber', async () => {
    const ctx = makeCtx({ tenantId: 't_news_case' });
    const env = buildEnv(ctx);
    await handleSubscribeRequest(postBody({ email: 'mixedcase@example.com' }), env);
    await handleSubscribeRequest(postBody({ email: 'MixedCase@Example.com' }), env);
    const rows = ctx.db._getTable('newsletter_subscribers');
    expect(rows.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('handleSubscribeRequest — input validation', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 on bad email and does NOT insert', async () => {
    const ctx = makeCtx({ tenantId: 't_news_bad' });
    const env = buildEnv(ctx);
    const res = await handleSubscribeRequest(postBody({ email: 'not-an-email' }), env);
    expect(res.status).toBe(400);
    const rows = ctx.db._getTable('newsletter_subscribers');
    expect(rows.length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 on bad JSON', async () => {
    const ctx = makeCtx({ tenantId: 't_news_badjson' });
    const env = buildEnv(ctx);
    const req = new Request('https://example.com/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.20' },
      body: '{{{not json}}}',
    });
    const res = await handleSubscribeRequest(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when the body exceeds 8 KB', async () => {
    const ctx = makeCtx({ tenantId: 't_news_big' });
    const env = buildEnv(ctx);
    const big = 'a'.repeat(8_500);
    const req = new Request('https://example.com/api/subscribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.21',
        'content-length': String(big.length + 30),
      },
      body: JSON.stringify({ email: 'a@b.io', padding: big }),
    });
    const res = await handleSubscribeRequest(req, env);
    expect(res.status).toBe(400);
  });

  it('returns 405 on a non-POST method', async () => {
    const ctx = makeCtx({ tenantId: 't_news_get' });
    const env = buildEnv(ctx);
    const req = new Request('https://example.com/api/subscribe', { method: 'GET' });
    const res = await handleSubscribeRequest(req, env);
    expect(res.status).toBe(405);
  });
});

describe('handleSubscribeRequest — rate limit', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 429 on the (SUBSCRIBE_RATE_LIMIT_MAX + 1)-th call from the same IP', async () => {
    const ctx = makeCtx({ tenantId: 't_news_rl' });
    const env = buildEnv(ctx);
    const ip = '203.0.113.99';
    // Pre-fill the limiter to (max - 1) directly so we don't burn 60 inserts.
    await dbRun(
      ctx,
      `INSERT INTO rate_limits (key, action, count, window_start)
       VALUES (?, ?, ?, ?)`,
      ip,
      'subscribe',
      SUBSCRIBE_RATE_LIMIT_MAX,
      Math.floor(Date.now() / 1000),
    );
    const res = await handleSubscribeRequest(postBody({ email: 'over@example.com' }, ip), env);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleSubscribeRequest — welcome dispatch error paths', () => {
  it('stamps welcome_send_error when INTERNAL_API_TOKEN is unset and still returns 202', async () => {
    const ctx = makeCtx({ tenantId: 't_news_no_token' });
    const env = buildEnv(ctx, { INTERNAL_API_TOKEN: undefined });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await handleSubscribeRequest(postBody({ email: 'notoken@example.com' }), env);
      expect(res.status).toBe(202);
      expect(fetchMock).not.toHaveBeenCalled();
      const row = await dbGet(
        ctx,
        'SELECT welcome_send_error FROM newsletter_subscribers WHERE email = ?',
        'notoken@example.com',
      );
      expect(row?.welcome_send_error).toBe('internal_api_token_unset');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stamps welcome_send_error when ADMIN_APP_URL is unset', async () => {
    const ctx = makeCtx({ tenantId: 't_news_no_url' });
    const env = buildEnv(ctx, { ADMIN_APP_URL: undefined });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await handleSubscribeRequest(postBody({ email: 'nourl@example.com' }), env);
      expect(res.status).toBe(202);
      expect(fetchMock).not.toHaveBeenCalled();
      const row = await dbGet(
        ctx,
        'SELECT welcome_send_error FROM newsletter_subscribers WHERE email = ?',
        'nourl@example.com',
      );
      expect(row?.welcome_send_error).toBe('admin_app_url_unset');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stamps welcome_send_error when admin-app returns non-200', async () => {
    const ctx = makeCtx({ tenantId: 't_news_500' });
    const env = buildEnv(ctx);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await handleSubscribeRequest(postBody({ email: 'badroute@example.com' }), env);
      expect(res.status).toBe(202);
      const row = await dbGet(
        ctx,
        'SELECT welcome_send_error FROM newsletter_subscribers WHERE email = ?',
        'badroute@example.com',
      );
      expect(row?.welcome_send_error).toBe('admin_app_503');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stamps welcome_send_error when fetch throws', async () => {
    const ctx = makeCtx({ tenantId: 't_news_throw' });
    const env = buildEnv(ctx);
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await handleSubscribeRequest(postBody({ email: 'thrown@example.com' }), env);
      expect(res.status).toBe(202);
      const row = await dbGet(
        ctx,
        'SELECT welcome_send_error FROM newsletter_subscribers WHERE email = ?',
        'thrown@example.com',
      );
      expect(row?.welcome_send_error).toBe('fetch_failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('buildSubscriberInsertParams', () => {
  it('caps the user-agent at 500 chars', () => {
    const parsed = parseSubscribePayload({ email: 'a@b.io' });
    expect(parsed.ok).toBe(true);
    const row = buildSubscriberInsertParams(parsed.value, {
      ip: '1.2.3.4',
      userAgent: 'x'.repeat(2000),
      nowSec: 1700000000,
    });
    expect(row.userAgent.length).toBe(500);
  });

  it('returns null for an empty UA / IP', () => {
    const parsed = parseSubscribePayload({ email: 'a@b.io' });
    expect(parsed.ok).toBe(true);
    const row = buildSubscriberInsertParams(parsed.value, {
      ip: null,
      userAgent: '',
      nowSec: 1700000000,
    });
    expect(row.ip).toBe(null);
    expect(row.userAgent).toBe(null);
  });
});

describe('dispatchWelcomeEmail', () => {
  it('returns sent on a 200 admin-app response', async () => {
    const ctx = makeCtx({ tenantId: 't_news_disp_ok' });
    const env = buildEnv(ctx);
    // Insert a row so the stamp UPDATE has something to write.
    await dbRun(
      ctx,
      `INSERT INTO newsletter_subscribers (email, source, lang, anonymous_id, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'sentcheck@example.com',
      'landing',
      'en',
      null,
      '127.0.0.1',
      'vitest',
      Math.floor(Date.now() / 1000),
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const state = await dispatchWelcomeEmail(env, 'sentcheck@example.com', 'en');
      expect(state).toBe('sent');
      const row = await dbGet(
        ctx,
        'SELECT welcome_send_error FROM newsletter_subscribers WHERE email = ?',
        'sentcheck@example.com',
      );
      // welcome_send_error stays null on success — admin-app stamps welcome_sent_at, not this path.
      expect(row?.welcome_send_error ?? null).toBe(null);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
