/**
 * Admin/ops bot — owner-only security gate.
 * The bot is reachable by anyone who finds its @username; every update must be
 * gated by ADMIN_CHAT_ID (+ optional allowlist). Non-owners are silently dropped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isAdminAuthorized, onAdminMsg, onAdminCb } from '../src/adminbot/handler.js';

const OWNER = '500';
function ctx(extra = {}) {
  return {
    TG: 'https://api.telegram.org/botTEST',
    adminChatId: OWNER,
    ADMIN_BOT_ALLOWED_IDS: '600 700',
    prefix: 'adm:TEST:',
    kv: { get: async () => null, put: async () => {}, delete: async () => {} },
    ...extra,
  };
}
const msg = (fromId, text = '/start') => ({ chat: { id: fromId, type: 'private' }, from: { id: fromId }, text });
const cbq = (fromId, data = 'ab') => ({ id: 'c1', from: { id: fromId }, message: { chat: { id: fromId, type: 'private' } }, data });

describe('isAdminAuthorized', () => {
  it('allows creator (ADMIN_CHAT_ID) and allowlisted ids', () => {
    const c = ctx();
    expect(isAdminAuthorized(c, 500)).toBe(true);   // numeric == string creator
    expect(isAdminAuthorized(c, '500')).toBe(true);
    expect(isAdminAuthorized(c, 600)).toBe(true);
    expect(isAdminAuthorized(c, 700)).toBe(true);
  });
  it('denies non-owner, null, undefined', () => {
    const c = ctx();
    expect(isAdminAuthorized(c, 999)).toBe(false);
    expect(isAdminAuthorized(c, null)).toBe(false);
    expect(isAdminAuthorized(c, undefined)).toBe(false);
  });
});

describe('onAdminMsg / onAdminCb gate', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('non-owner message → silent drop (no Telegram call)', async () => {
    await onAdminMsg(ctx(), msg(999));
    expect(globalThis.fetch.mock.calls.length).toBe(0);
  });

  it('owner message → routed (a Telegram send happens)', async () => {
    await onAdminMsg(ctx(), msg(OWNER, '/start'));
    const calls = globalThis.fetch.mock.calls;
    expect(calls.some(([u]) => String(u).includes('/sendMessage'))).toBe(true);
  });

  it('non-owner callback → answered empty, no action send', async () => {
    await onAdminCb(ctx(), cbq(999, 'ab:st'));
    const calls = globalThis.fetch.mock.calls;
    expect(calls.some(([u]) => String(u).includes('/answerCallbackQuery'))).toBe(true);
    expect(calls.some(([u]) => String(u).includes('/sendMessage'))).toBe(false);
  });
});
