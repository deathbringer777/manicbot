/**
 * GET /admin/bots-status — God Mode: live Telegram webhook status for every bot.
 * Auth: Bearer ADMIN_KEY. Read-only (getWebhookInfo per bot, in parallel).
 * Returns webhook metadata ONLY — never the bot token. Backs the admin-app
 * God Mode "Bots" page (see all bots + re-register a broken webhook).
 *
 * Also covers GET /admin/reset-webhooks?botId=<id> — re-register a SINGLE bot
 * (the per-row "Переустановить" button) vs the no-arg "fix all" behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tryAdminKeyRoutes } from '../src/http/adminKeyHttp.js';
import { putTenant, putBot } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

const ADMIN = 'admin-key-with-at-least-thirty-two-characters-xx';
const ENC_KEY = 'test-encryption-key-32-bytes-long-1234';

function makeEnv(db, overrides = {}) {
  return { ADMIN_KEY: ADMIN, BOT_ENCRYPTION_KEY: ENC_KEY, DB: db, APP_BASE_URL: 'https://manicbot.com', ...overrides };
}

function makeReq(path, { auth } = {}) {
  const headers = new Headers();
  if (auth) headers.set('Authorization', `Bearer ${auth}`);
  return new Request(`https://manicbot.com${path}`, { method: 'GET', headers });
}

async function seedTwoBots(ctx) {
  const now = Math.floor(Date.now() / 1000);
  await putTenant(ctx, 't_a', { id: 't_a', name: 'Salon A', active: true, createdAt: now, updatedAt: now });
  await putTenant(ctx, 't_b', { id: 't_b', name: 'Salon B', active: true, createdAt: now, updatedAt: now });
  await putBot(ctx, '100', { botId: '100', tenantId: 't_a', botToken: '100:tokA', botUsername: 'a_bot', webhookSecret: 'wh_a_secret_16ch', active: true, createdAt: now, updatedAt: now }, ENC_KEY);
  await putBot(ctx, '200', { botId: '200', tenantId: 't_b', botToken: '200:tokB', botUsername: 'b_bot', webhookSecret: 'wh_b_secret_16ch', active: true, createdAt: now, updatedAt: now }, ENC_KEY);
}

describe('GET /admin/bots-status', () => {
  let ctx, fetchCalls, originalFetch;
  beforeEach(async () => {
    ctx = { db: createMockD1(), kv: makeMockKv() };
    ctx.globalKv = ctx.kv;
    await seedTwoBots(ctx);
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u) => {
      fetchCalls.push(String(u));
      // bot 100 → webhook registered; bot 200 → empty url (the broken state)
      const isBot100 = String(u).includes('100:tokA');
      const result = isBot100
        ? { url: 'https://manicbot.com/webhook/100', pending_update_count: 0, last_error_message: null }
        : { url: '', pending_update_count: 3, last_error_message: null };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('rejects without ADMIN_KEY (403, no Telegram calls)', async () => {
    const req = makeReq('/admin/bots-status');
    const res = await tryAdminKeyRoutes(req, makeEnv(ctx.db), new URL(req.url));
    expect(res.status).toBe(403);
    expect(fetchCalls.length).toBe(0);
  });

  it('returns live webhook status per bot and never leaks the token', async () => {
    const req = makeReq('/admin/bots-status', { auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, makeEnv(ctx.db), new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);

    const byId = Object.fromEntries(data.bots.map((b) => [b.botId, b]));
    expect(byId['100'].webhook.set).toBe(true);
    expect(byId['100'].webhook.url).toBe('https://manicbot.com/webhook/100');
    expect(byId['100'].username).toBe('a_bot');
    expect(byId['100'].tenantId).toBe('t_a');
    expect(byId['100'].active).toBe(true);

    expect(byId['200'].webhook.set).toBe(false);
    expect(byId['200'].webhook.pending).toBe(3);

    // SECURITY: the response must carry webhook metadata only — never the token.
    const raw = JSON.stringify(data);
    expect(raw).not.toContain('tokA');
    expect(raw).not.toContain('tokB');
  });
});

describe('GET /admin/reset-webhooks?botId=', () => {
  let ctx, fetchCalls, originalFetch;
  beforeEach(async () => {
    ctx = { db: createMockD1(), kv: makeMockKv() };
    ctx.globalKv = ctx.kv;
    await seedTwoBots(ctx);
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u, init) => {
      fetchCalls.push({ url: String(u), body: init?.body });
      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    });
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('re-registers ONLY the requested bot when botId is supplied', async () => {
    const req = makeReq('/admin/reset-webhooks?botId=100', { auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, makeEnv(ctx.db), new URL(req.url));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].url).toContain('100:tokA/setWebhook');
    expect(JSON.parse(fetchCalls[0].body).url).toBe('https://manicbot.com/webhook/100');
  });

  it('re-registers ALL bots when no botId is supplied', async () => {
    const req = makeReq('/admin/reset-webhooks', { auth: ADMIN });
    const res = await tryAdminKeyRoutes(req, makeEnv(ctx.db), new URL(req.url));
    expect(res.status).toBe(200);
    expect(fetchCalls.length).toBe(2);
  });
});
