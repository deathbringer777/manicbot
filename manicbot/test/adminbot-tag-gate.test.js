/**
 * Admin/ops bot — fail-closed tag gate.
 * READ tags are directly runnable; MUTATING tags are NEVER directly executable
 * (a hallucinated [OPS_*] can at most surface a confirm button).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  canRunAdminTag, ADMIN_READ_TAGS, ADMIN_MUTATING_TAGS, executeAdminAction,
} from '../src/adminbot/dispatcher.js';
import { CB } from '../src/config.js';

function adminCtx() {
  return { TG: 'https://api.telegram.org/botTEST', adminChatId: '500' };
}

describe('canRunAdminTag — fail-closed', () => {
  it('allows every READ tag', () => {
    for (const tag of ADMIN_READ_TAGS) expect(canRunAdminTag(tag), tag).toBe(true);
  });
  it('denies every MUTATING tag (not directly runnable)', () => {
    for (const tag of ADMIN_MUTATING_TAGS) expect(canRunAdminTag(tag), tag).toBe(false);
  });
  it('denies unknown / empty / null', () => {
    expect(canRunAdminTag('TOTALLY_NEW')).toBe(false);
    expect(canRunAdminTag('')).toBe(false);
    expect(canRunAdminTag(undefined)).toBe(false);
    expect(canRunAdminTag(null)).toBe(false);
  });
});

describe('executeAdminAction — mutating tag surfaces confirm, never executes', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('OPS_RESET_WEBHOOKS → confirm keyboard, no setWebhook call', async () => {
    const handled = await executeAdminAction(adminCtx(), 500, 'OPS_RESET_WEBHOOKS', '', { id: 500 });
    expect(handled).toBe(true);
    const calls = globalThis.fetch.mock.calls;
    // exactly one Telegram call: the confirm sendMessage
    expect(calls.length).toBe(1);
    const [url, opts] = calls[0];
    expect(String(url)).toContain('/sendMessage');
    expect(String(url)).not.toContain('/setWebhook');
    const body = JSON.parse(opts.body);
    const data = JSON.stringify(body.reply_markup);
    expect(data).toContain(CB.ADMINBOT_CONFIRM_RESET_WH);
  });

  it('unknown tag → returns false, no send', async () => {
    const handled = await executeAdminAction(adminCtx(), 500, 'NUKE_EVERYTHING', '', { id: 500 });
    expect(handled).toBe(false);
    expect(globalThis.fetch.mock.calls.length).toBe(0);
  });
});
