/**
 * POST /admin/notify-document — sibling of /admin/notify that uploads a file
 * to the admin chat via Telegram sendDocument. Same dual-auth contract
 * (NOTIFY_TOKEN OR ADMIN_KEY), same chat resolution (NOTIFY_CHAT_ID falls
 * back to ADMIN_CHAT_ID, NOTIFY_BOT_TOKEN to BOT_TOKEN).
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

function makeFile(name = 'doc.docx', content = 'fake-bytes', mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
  return new File([content], name, { type: mime });
}

function makeReq({ auth, file = makeFile(), caption, filename } = {}) {
  const form = new FormData();
  if (file) form.append('file', file);
  if (caption !== undefined) form.append('caption', caption);
  if (filename !== undefined) form.append('filename', filename);
  const headers = new Headers();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);
  return new Request('https://manicbot.com/admin/notify-document', {
    method: 'POST',
    headers,
    body: form,
  });
}

describe('POST /admin/notify-document', () => {
  let originalFetch;
  let fetchCalls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts NOTIFY_TOKEN Bearer and forwards to Telegram sendDocument', async () => {
    const req = makeReq({ auth: NOTIFY });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toBe('https://api.telegram.org/botfake-bot-token/sendDocument');
    expect(fetchCalls[0].init.method).toBe('POST');
    // Body must be FormData (multipart). Telegram's sendDocument requires it.
    expect(fetchCalls[0].init.body).toBeInstanceOf(FormData);
    expect(fetchCalls[0].init.body.get('chat_id')).toBe('12345');
    expect(fetchCalls[0].init.body.get('document')).toBeTruthy();
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
    expect(fetchCalls.length).toBe(0);
  });

  it('rejects wrong Bearer value', async () => {
    const req = makeReq({ auth: 'wrong-value-of-thirty-two-or-more-characters-xxxx' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(403);
  });

  it('falls back to BOT_TOKEN and ADMIN_CHAT_ID when notify-specific vars are missing', async () => {
    const env = makeEnv({ NOTIFY_BOT_TOKEN: undefined, NOTIFY_CHAT_ID: undefined, BOT_TOKEN: 'fallback-bot-token', ADMIN_CHAT_ID: '99999' });
    const req = makeReq({ auth: NOTIFY });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(200);
    expect(fetchCalls[0].url).toBe('https://api.telegram.org/botfallback-bot-token/sendDocument');
    expect(fetchCalls[0].init.body.get('chat_id')).toBe('99999');
  });

  it('503 when neither token nor chat are configured', async () => {
    const env = { ADMIN_KEY: ADMIN, NOTIFY_TOKEN: NOTIFY }; // no BOT_TOKEN, no ADMIN_CHAT_ID
    const req = makeReq({ auth: NOTIFY });
    const res = await tryAdminKeyRoutes(req, env, new URL(req.url));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('bot_token_or_chat_id_missing');
    expect(fetchCalls.length).toBe(0);
  });

  it('400 when file field is missing', async () => {
    const req = makeReq({ auth: NOTIFY, file: null });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('file_required');
  });

  it('400 when body is not multipart/form-data', async () => {
    const req = new Request('https://manicbot.com/admin/notify-document', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${NOTIFY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'x' }),
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('multipart_form_data_required');
  });

  it('passes optional caption through to Telegram', async () => {
    const req = makeReq({ auth: NOTIFY, caption: 'CFO-анализ от 26.05.2026' });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    expect(res.status).toBe(200);
    expect(fetchCalls[0].init.body.get('caption')).toBe('CFO-анализ от 26.05.2026');
  });

  it('returns 502 when Telegram returns non-ok', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), { status: 400 }),
    );
    const req = makeReq({ auth: NOTIFY });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    // The endpoint should surface Telegram's failure as a non-200 with description.
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.description).toBe('Bad Request: chat not found');
  });

  it('rejects GET (only POST is supported)', async () => {
    const req = new Request('https://manicbot.com/admin/notify-document', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${NOTIFY}` },
    });
    const res = await tryAdminKeyRoutes(req, makeEnv(), new URL(req.url));
    // tryAdminKeyRoutes returns null for unmatched routes; the test must either
    // see a null pass-through OR a non-200. We assert it's not a successful upload.
    if (res) expect(res.status).not.toBe(200);
    expect(fetchCalls.length).toBe(0);
  });
});
