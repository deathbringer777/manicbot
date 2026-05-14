/**
 * Tests for POST /admin/ig-resubscribe — re-subscribes the Facebook Page
 * (linked to an Instagram Business account) to the Messenger Platform
 * webhook fields we need for IG DMs: messages, messaging_postbacks,
 * message_reads. Without these the Page is wired to the App but Meta
 * never delivers `entry.messaging[]` events to our /webhook/ig.
 *
 * Diagnosed live: the worker tail showed zero IG POSTs over a 2-min
 * window after a real user message — Page subscription had silently
 * lapsed. This endpoint gives us a no-touch recovery path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../src/utils/audit.js', () => ({ audit: vi.fn(async () => {}) }));

const FAKE_KEY = 'k'.repeat(32);
const ADMIN_KEY = 'a'.repeat(48);

// IG token stored encrypted in channel_configs. We mock decryptToken to
// hand back a known plaintext without exercising AES-GCM in the test.
vi.mock('../src/utils/security.js', async () => {
  const actual = await vi.importActual('../src/utils/security.js');
  return {
    ...actual,
    decryptToken: vi.fn(async () => 'EAA_test_token'),
  };
});

import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';

function makeRequest({ body, auth = `Bearer ${ADMIN_KEY}` } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (auth) headers.set('Authorization', auth);
  return new Request('https://manicbot.com/admin/ig-resubscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

function call(env, opts = {}) {
  const req = makeRequest(opts);
  const url = new URL(req.url);
  return tryAdminKeyRoutes(req, env, url);
}

function makeEnv({ rows = [] } = {}) {
  return {
    ADMIN_KEY,
    BOT_ENCRYPTION_KEY: FAKE_KEY,
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return rows[0] ?? null; },
          async all() { return { results: rows }; },
        };
      },
    },
  };
}

describe('POST /admin/ig-resubscribe', () => {
  let fetchSpy;
  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (urlObj) => {
      const u = String(urlObj);
      if (u.includes('/subscribed_apps')) {
        // Graph returns `{ success: true }` for the POST.
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
  });

  it('403 without Bearer key', async () => {
    const env = makeEnv();
    const res = await call(env, { auth: '' });
    expect(res?.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('503 when BOT_ENCRYPTION_KEY missing', async () => {
    const env = makeEnv();
    delete env.BOT_ENCRYPTION_KEY;
    const res = await call(env, { body: { tenantId: 't_1' } });
    expect(res?.status).toBe(503);
  });

  it('subscribes the Page to messages, messaging_postbacks, message_reads', async () => {
    const env = makeEnv({
      rows: [
        {
          tenant_id: 't_1',
          page_id: '1008301152373103',
          token_encrypted: 'enc:whatever',
        },
      ],
    });
    const res = await call(env, { body: { tenantId: 't_1' } });
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].tenantId).toBe('t_1');
    expect(body.results[0].pageId).toBe('1008301152373103');
    expect(body.results[0].graphSuccess).toBe(true);

    // Verify the exact Graph call.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    expect(calledUrl).toContain('/1008301152373103/subscribed_apps');
    expect(calledUrl).toContain('access_token=EAA_test_token');
    expect(calledUrl).toContain('subscribed_fields=');
    expect(calledUrl).toContain('messages');
    expect(calledUrl).toContain('messaging_postbacks');
    expect(calledUrl).toContain('message_reads');
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
  });

  it('skips rows without a page_id or token', async () => {
    const env = makeEnv({
      rows: [
        { tenant_id: 't_a', page_id: null, token_encrypted: 'enc' },
        { tenant_id: 't_b', page_id: '999', token_encrypted: null },
      ],
    });
    const res = await call(env, { body: {} });
    expect(res?.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results.every(r => r.graphSuccess === false)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
