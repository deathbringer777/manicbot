/**
 * #P0-3 — Telegram webhook MUST return 5xx when initServices fails so
 * Telegram retries the update. Pre-fix the handler swallowed the error
 * and returned 200, which made Telegram drop the update entirely (no
 * answer to user, no second chance).
 *
 * Handler-level errors (post-init) should still ack 200 — the message is
 * either malformed or hits a real bug; retrying won't help and would risk
 * duplicate side effects.
 */
import { describe, it, expect, vi } from 'vitest';
import { tryTelegramWebhook } from '../src/http/telegramWebhookHttp.js';

// Stub initServices BEFORE the import sees it. Vitest hoists vi.mock to
// the top of the file, so we set the implementation per-test via vi.fn.
const initSpy = vi.fn();
vi.mock('../src/services/services.js', () => ({
  initServices: (...args) => initSpy(...args),
  getConfig: vi.fn(),
}));

const onMsgSpy = vi.fn();
vi.mock('../src/handlers/message.js', () => ({
  onMsg: (...args) => onMsgSpy(...args),
}));

const onCbSpy = vi.fn();
vi.mock('../src/handlers/callback.js', () => ({
  onCb: (...args) => onCbSpy(...args),
}));

const claimSpy = vi.fn();
vi.mock('../src/utils/dedup.js', () => ({
  claimTelegramUpdate: (...args) => claimSpy(...args),
}));

function makeReq(body, secret = 'a'.repeat(32)) {
  return new Request('https://manicbot.com/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': secret,
    },
    body: JSON.stringify(body),
  });
}

const SECRET = 'a'.repeat(32);
const baseCtx = () => ({
  WEBHOOK_SECRET: SECRET,
  kv: { get: async () => null, put: async () => {}, delete: async () => {} },
  botId: 'bot123',
});

describe('telegram webhook — error handling (#P0-3)', () => {
  beforeEach: () => { initSpy.mockReset(); onMsgSpy.mockReset(); onCbSpy.mockReset(); claimSpy.mockReset(); };

  it('returns 500 when initServices throws so Telegram retries', async () => {
    initSpy.mockReset();
    onMsgSpy.mockReset();
    claimSpy.mockReset();
    claimSpy.mockResolvedValue(true);
    initSpy.mockRejectedValue(new Error('D1 binding lost'));
    const ctx = baseCtx();
    const url = new URL('https://manicbot.com/webhook');
    const req = makeReq({
      update_id: 1,
      message: { chat: { id: 7 }, from: { id: 7 }, text: '/start' },
    });
    const res = await tryTelegramWebhook(req, ctx, url);
    expect(res?.status).toBe(500);
    expect(onMsgSpy).not.toHaveBeenCalled();
  });

  it('returns 200 when handler throws AFTER successful init', async () => {
    initSpy.mockReset();
    onMsgSpy.mockReset();
    claimSpy.mockReset();
    claimSpy.mockResolvedValue(true);
    initSpy.mockResolvedValue(undefined);
    onMsgSpy.mockRejectedValue(new Error('downstream bug'));
    const ctx = baseCtx();
    const url = new URL('https://manicbot.com/webhook');
    const req = makeReq({
      update_id: 2,
      message: { chat: { id: 7 }, from: { id: 7 }, text: 'hi' },
    });
    const res = await tryTelegramWebhook(req, ctx, url);
    // Handler-phase failure: ack 200, log internally — Telegram should NOT
    // retry because the same update will hit the same bug.
    expect(res?.status).toBe(200);
    expect(initSpy).toHaveBeenCalledOnce();
    expect(onMsgSpy).toHaveBeenCalledOnce();
  });

  it('happy path returns 200 and forwards the message', async () => {
    initSpy.mockReset();
    onMsgSpy.mockReset();
    claimSpy.mockReset();
    claimSpy.mockResolvedValue(true);
    initSpy.mockResolvedValue(undefined);
    onMsgSpy.mockResolvedValue(undefined);
    const ctx = baseCtx();
    const url = new URL('https://manicbot.com/webhook');
    const req = makeReq({
      update_id: 3,
      message: { chat: { id: 7 }, from: { id: 7 }, text: 'hi' },
    });
    const res = await tryTelegramWebhook(req, ctx, url);
    expect(res?.status).toBe(200);
    expect(onMsgSpy).toHaveBeenCalledOnce();
  });

  it('returns 200 (no init) on duplicate update_id', async () => {
    initSpy.mockReset();
    onMsgSpy.mockReset();
    claimSpy.mockReset();
    // Second call to claimTelegramUpdate sees the existing claim → returns false.
    claimSpy.mockResolvedValue(false);
    const ctx = baseCtx();
    const url = new URL('https://manicbot.com/webhook');
    const req = makeReq({
      update_id: 4,
      message: { chat: { id: 7 }, from: { id: 7 }, text: 'replay' },
    });
    const res = await tryTelegramWebhook(req, ctx, url);
    expect(res?.status).toBe(200);
    expect(initSpy).not.toHaveBeenCalled();
    expect(onMsgSpy).not.toHaveBeenCalled();
  });
});
