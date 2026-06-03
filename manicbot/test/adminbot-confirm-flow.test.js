/**
 * Admin/ops bot — mutation confirm flow.
 * A mutating op runs ONLY from a CB.ADMINBOT_CONFIRM_* tap; the ops-menu button
 * only surfaces a confirm; non-owners are denied.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/adminbot/ops.js', () => ({
  opsResetWebhooks: vi.fn(async () => ({ count: 2, ok: 2, failed: [] })),
  opsTestNotify: vi.fn(async () => ({ ok: true })),
  opsMarketingTick: vi.fn(async () => ({ ok: true })),
}));

import { onAdminCb } from '../src/adminbot/handler.js';
import { CB } from '../src/config.js';
import * as ops from '../src/adminbot/ops.js';

const OWNER = '500';
const ctx = () => ({ TG: 'https://api.telegram.org/botTEST', adminChatId: OWNER });
const cbq = (data, fromId = OWNER) => ({ id: 'c1', from: { id: fromId }, message: { chat: { id: fromId, type: 'private' } }, data });

describe('mutation confirm flow', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('ops button → confirm keyboard, op NOT executed', async () => {
    await onAdminCb(ctx(), cbq(CB.ADMINBOT_OPS_RESET_WH));
    expect(ops.opsResetWebhooks).not.toHaveBeenCalled();
    const sm = globalThis.fetch.mock.calls.find(([u]) => String(u).includes('/sendMessage'));
    expect(sm).toBeTruthy();
    expect(JSON.stringify(JSON.parse(sm[1].body))).toContain(CB.ADMINBOT_CONFIRM_RESET_WH);
  });

  it('confirm tap → op executed exactly once', async () => {
    await onAdminCb(ctx(), cbq(CB.ADMINBOT_CONFIRM_RESET_WH));
    expect(ops.opsResetWebhooks).toHaveBeenCalledTimes(1);
  });

  it('non-owner confirm tap → denied, op NOT executed', async () => {
    await onAdminCb(ctx(), cbq(CB.ADMINBOT_CONFIRM_RESET_WH, '999'));
    expect(ops.opsResetWebhooks).not.toHaveBeenCalled();
  });
});
