/**
 * Admin/ops bot — webhook routing: getCtx intercepts the admin botId, and
 * onMsg short-circuits to the admin pipeline.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/adminbot/handler.js', () => ({
  onAdminMsg: vi.fn(async () => 'ADMIN_MSG'),
  onAdminCb: vi.fn(async () => 'ADMIN_CB'),
}));

import { getCtx } from '../src/http/resolveCtx.js';
import { onMsg } from '../src/handlers/message.js';
import { onAdminMsg } from '../src/adminbot/handler.js';

const SECRET = 'admin-webhook-secret-32-chars-minimum-xx';

describe('getCtx admin interception', () => {
  it('returns the tenant-less admin ctx for the admin botId (no DB → no collision)', async () => {
    const env = { ADMIN_BOT_TOKEN: '777:abc', ADMIN_WEBHOOK_SECRET: SECRET };
    const ctx = await getCtx(env, new URL('https://manicbot.com/webhook/777'), { method: 'POST' });
    expect(ctx?.isAdminBot).toBe(true);
    expect(ctx?.tenantId).toBe(null);
  });

  it('does NOT intercept when ADMIN_WEBHOOK_SECRET is missing (secret-gated)', async () => {
    const env = { ADMIN_BOT_TOKEN: '777:abc' }; // no secret, no DB, no BOT_TOKEN
    const ctx = await getCtx(env, new URL('https://manicbot.com/webhook/777'), { method: 'POST' });
    expect(ctx).toBe(null);
  });
});

describe('onMsg short-circuit', () => {
  it('routes to onAdminMsg when ctx.isAdminBot', async () => {
    const r = await onMsg({ isAdminBot: true }, { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'hi' });
    expect(onAdminMsg).toHaveBeenCalledTimes(1);
    expect(r).toBe('ADMIN_MSG');
  });
});
