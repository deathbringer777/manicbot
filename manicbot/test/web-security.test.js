/**
 * Security-focused tests for the web chat channel.
 *
 * These tests verify the three lockdown mechanisms shipped together:
 *
 *  1. WebAdapter outbox isolation — staff messages never leak into the
 *     client's outbox.
 *  2. telegram.js send/edit reroute — out-of-session messages on the web
 *     channel are forwarded to Telegram (via tgApi mock) instead.
 *  3. Role lockdown — getRole / isAdmin / isPlatformAdmin / resolveRole all
 *     force the active web session's chat_id to the client role even if a
 *     stale tenant_roles row matches the hashed id.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebAdapter } from '../src/channels/web.js';
import { send, edit, sendPhoto } from '../src/telegram.js';
import { isAdmin, isPlatformAdmin, getRole, isWebSessionLocked } from '../src/services/users.js';
import { resolveRole, ROLES } from '../src/roles/roles.js';

// Capture all fetch calls (tgApi uses global fetch)
const fetchCalls = [];
beforeEach(() => {
  fetchCalls.length = 0;
  globalThis.fetch = vi.fn(async (url, init) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

function makeKv() {
  const store = new Map();
  return {
    _store: store,
    async get(key, type) {
      const v = store.get(key);
      if (!v) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

const ACTIVE_CHAT = -185627397125813; // typical web session hashed id
const STAFF_TG_CHAT = 123456789;       // a real Telegram positive chat id

function makeWebCtx({ withTG = true } = {}) {
  const adapter = new WebAdapter({ tenantId: 't_demo' });
  adapter.setActiveChat(ACTIVE_CHAT);
  const kv = makeKv();
  const ctx = {
    tenantId: 't_demo',
    db: null, // role tests below provide their own db where needed
    kv,
    channel: adapter,
    TG: withTG ? 'https://api.telegram.org/bot123:abc' : null,
    adminChatId: null,
    _webSessionChatId: ACTIVE_CHAT,
    _lockToClientRole: true,
  };
  adapter._ctx = ctx;
  return { ctx, adapter };
}

// ─── 1. Outbox isolation via telegram.js:send ────────────────────────────────

describe('SECURITY: telegram.js send() reroutes web out-of-session messages', () => {
  it('echoes a message to the web outbox when recipient === active session', async () => {
    const { ctx, adapter } = makeWebCtx();
    await send(ctx, ACTIVE_CHAT, 'Hello client');
    expect(adapter._outbox).toHaveLength(1);
    expect(adapter._outbox[0].text).toBe('Hello client');
    // No Telegram API call was made
    expect(fetchCalls).toHaveLength(0);
  });

  it('reroutes a staff notification via Telegram, NEVER touching the outbox', async () => {
    const { ctx, adapter } = makeWebCtx();
    await send(ctx, STAFF_TG_CHAT, '🆕 Новая заявка!', {
      reply_markup: { inline_keyboard: [[{ text: 'Подтвердить', callback_data: 'apt:confirm:1' }]] },
    });
    // ZERO writes to the web outbox
    expect(adapter._outbox).toHaveLength(0);
    // ONE Telegram API call to sendMessage with the staff chat id
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('/sendMessage');
    const body = JSON.parse(fetchCalls[0].body);
    expect(body.chat_id).toBe(STAFF_TG_CHAT);
    expect(body.text).toBe('🆕 Новая заявка!');
    // Inline keyboard was forwarded
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('apt:confirm:1');
  });

  it('drops staff notifications when no Telegram bot is configured (fail-closed)', async () => {
    const { ctx, adapter } = makeWebCtx({ withTG: false });
    const result = await send(ctx, STAFF_TG_CHAT, '🆕 Новая заявка!');
    expect(result).toEqual({ ok: false, error: 'no_tg_fallback' });
    expect(adapter._outbox).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it('edit() reroutes out-of-session messages via Telegram editMessageText', async () => {
    const { ctx, adapter } = makeWebCtx();
    await edit(ctx, STAFF_TG_CHAT, 42, 'updated', { reply_markup: { inline_keyboard: [] } });
    expect(adapter._outbox).toHaveLength(0);
    expect(fetchCalls[0].url).toContain('/editMessageText');
    const body = JSON.parse(fetchCalls[0].body);
    expect(body.chat_id).toBe(STAFF_TG_CHAT);
    expect(body.message_id).toBe(42);
  });

  it('sendPhoto() reroutes out-of-session photos via Telegram', async () => {
    const { ctx, adapter } = makeWebCtx();
    await sendPhoto(ctx, STAFF_TG_CHAT, 'https://example.com/photo.png', 'caption');
    expect(adapter._outbox).toHaveLength(0);
    expect(fetchCalls[0].url).toContain('/sendPhoto');
  });
});

// ─── 2. Role lockdown ────────────────────────────────────────────────────────

describe('SECURITY: web session is hard-locked to the client role', () => {
  function makeRoleCtx({ tenantRoleRows = [], platformRoleRows = [], adminChatId = null } = {}) {
    return {
      tenantId: 't_demo',
      adminChatId,
      _webSessionChatId: ACTIVE_CHAT,
      _lockToClientRole: true,
      db: {
        prepare(sql) {
          return {
            bind(...params) {
              return {
                async first() {
                  if (sql.includes('FROM tenant_roles')) {
                    return tenantRoleRows.find((r) => r.tenant_id === params[0] && r.chat_id === params[1]) || null;
                  }
                  if (sql.includes('FROM platform_roles')) {
                    return platformRoleRows.find((r) => r.chat_id === params[0]) || null;
                  }
                  if (sql.includes('FROM tenant_config')) return null;
                  return null;
                },
                async all() { return { results: [] }; },
                async run() { return { success: true }; },
              };
            },
          };
        },
      },
    };
  }

  it('isWebSessionLocked returns true only for the active session id', () => {
    const ctx = { _lockToClientRole: true, _webSessionChatId: ACTIVE_CHAT };
    expect(isWebSessionLocked(ctx, ACTIVE_CHAT)).toBe(true);
    expect(isWebSessionLocked(ctx, String(ACTIVE_CHAT))).toBe(true);
    expect(isWebSessionLocked(ctx, STAFF_TG_CHAT)).toBe(false);
    expect(isWebSessionLocked({}, ACTIVE_CHAT)).toBe(false); // no flag → no lock
  });

  it('isAdmin returns false even when tenant_roles row says tenant_owner', async () => {
    const ctx = makeRoleCtx({
      tenantRoleRows: [{ tenant_id: 't_demo', chat_id: ACTIVE_CHAT, role: 'tenant_owner' }],
    });
    expect(await isAdmin(ctx, ACTIVE_CHAT)).toBe(false);
  });

  it('isPlatformAdmin returns false even when platform_roles row says system_admin', async () => {
    const ctx = makeRoleCtx({
      platformRoleRows: [{ chat_id: ACTIVE_CHAT, role: 'system_admin' }],
    });
    expect(await isPlatformAdmin(ctx, ACTIVE_CHAT)).toBe(false);
  });

  it('getRole returns "client" even when a tenant_owner row matches', async () => {
    const ctx = makeRoleCtx({
      tenantRoleRows: [{ tenant_id: 't_demo', chat_id: ACTIVE_CHAT, role: 'tenant_owner' }],
    });
    expect(await getRole(ctx, ACTIVE_CHAT)).toBe('client');
  });

  it('resolveRole returns CLIENT for the active session even with a master row', async () => {
    const ctx = makeRoleCtx({
      tenantRoleRows: [{ tenant_id: 't_demo', chat_id: ACTIVE_CHAT, role: 'master' }],
    });
    expect(await resolveRole(ctx, ACTIVE_CHAT)).toBe(ROLES.CLIENT);
  });

  it('lockdown does NOT affect other chat ids (e.g. legitimate masters)', async () => {
    const MASTER_CHAT = 555000111;
    const ctx = makeRoleCtx({
      tenantRoleRows: [{ tenant_id: 't_demo', chat_id: MASTER_CHAT, role: 'master' }],
    });
    expect(await getRole(ctx, MASTER_CHAT)).toBe('master');
    expect(await resolveRole(ctx, MASTER_CHAT)).toBe(ROLES.MASTER);
  });

  it('lockdown is OFF when _lockToClientRole flag is missing', async () => {
    const ctx = makeRoleCtx({
      tenantRoleRows: [{ tenant_id: 't_demo', chat_id: ACTIVE_CHAT, role: 'tenant_owner' }],
    });
    delete ctx._lockToClientRole;
    expect(await isAdmin(ctx, ACTIVE_CHAT)).toBe(true);
    expect(await getRole(ctx, ACTIVE_CHAT)).toBe('tenant_owner');
  });
});
