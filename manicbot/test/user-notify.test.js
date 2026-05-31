/**
 * userNotify — multi-channel notification fanout.
 *
 * Always writes in-app (unless opts.inapp=false). Optional Telegram dup
 * gated on the target having a non-synthetic master row. Synthetic personal
 * masters (is_synthetic=1) and ids >= 10B fall back to in-app only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const telegramSendMock = vi.fn(async () => ({ ok: true }));
vi.mock('../src/telegram.js', () => ({
  send: (...args) => telegramSendMock(...args),
}));

const { notifyWebUser } = await import('../src/services/userNotify.js');

async function seedMaster(ctx, masterRow) {
  await ctx.db.prepare(`
    INSERT INTO masters (tenant_id, chat_id, web_user_id, is_synthetic, name)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    masterRow.tenant_id,
    masterRow.chat_id,
    masterRow.web_user_id ?? null,
    masterRow.is_synthetic ?? 0,
    masterRow.name ?? 'M',
  ).run();
}

async function seedWebUser(ctx, row) {
  await ctx.db.prepare(`
    INSERT INTO web_users (id, tenant_id, telegram_chat_id, role)
    VALUES (?, ?, ?, ?)
  `).bind(
    row.id,
    row.tenant_id,
    row.telegram_chat_id ?? null,
    row.role ?? 'tenant_owner',
  ).run();
}

async function readNotifications(ctx, webUserId) {
  const rows = await ctx.db.prepare(
    `SELECT * FROM user_notifications WHERE web_user_id = ?`,
  ).bind(webUserId).all();
  return rows.results;
}

beforeEach(() => {
  telegramSendMock.mockReset();
  telegramSendMock.mockResolvedValue({ ok: true });
});

describe('notifyWebUser — in-app channel', () => {
  it('always inserts an in-app row when inapp=true (default)', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const res = await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired',
      title: 'Close register',
      sourceSlug: 'reminders',
      sourceId: 'r_1:1700000000',
    });
    expect(res).toMatchObject({ ok: true, inappOk: true, telegramOk: false });
    const rows = await readNotifications(ctx, 'wu_1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      web_user_id: 'wu_1',
      kind: 'reminder.fired',
      title: 'Close register',
      source_slug: 'reminders',
      source_id: 'r_1:1700000000',
    });
  });

  it('skips in-app when inapp=false', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const res = await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired', title: 'X', inapp: false,
    });
    expect(res.inappOk).toBe(false);
    const rows = await readNotifications(ctx, 'wu_1');
    expect(rows).toHaveLength(0);
  });

  it('truncates oversized title / body', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const longTitle = 'x'.repeat(300);
    const longBody = 'y'.repeat(2000);
    await notifyWebUser(ctx, 'wu_1', { kind: 'k', title: longTitle, body: longBody });
    const rows = await readNotifications(ctx, 'wu_1');
    expect(rows[0].title.length).toBe(200);
    expect(rows[0].body.length).toBe(1000);
  });

  it('refuses without kind or title', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    expect((await notifyWebUser(ctx, 'wu_1', { kind: 'k' })).ok).toBe(false);
    expect((await notifyWebUser(ctx, 'wu_1', { title: 't' })).ok).toBe(false);
  });

  it('returns failure when ctx or webUserId missing', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    expect((await notifyWebUser(null, 'wu_1', { kind: 'k', title: 't' })).ok).toBe(false);
    expect((await notifyWebUser(ctx, null, { kind: 'k', title: 't' })).ok).toBe(false);
  });
});

describe('notifyWebUser — Telegram channel resolution', () => {
  it('sends Telegram dup when target master is non-synthetic', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} }; // any truthy bot
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 555, web_user_id: 'wu_1', is_synthetic: 0 });
    const res = await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired',
      title: 'Close register',
      telegram: true,
    });
    expect(res.telegramOk).toBe(true);
    expect(telegramSendMock).toHaveBeenCalledWith(
      ctx,
      555,
      expect.stringContaining('Close register'),
    );
  });

  it('skips Telegram when target master is synthetic', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 555, web_user_id: 'wu_1', is_synthetic: 1 });
    const res = await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired', title: 'X', telegram: true,
    });
    expect(res.telegramOk).toBe(false);
    expect(telegramSendMock).not.toHaveBeenCalled();
  });

  it('skips Telegram when target has no master row at all', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    const res = await notifyWebUser(ctx, 'wu_unknown', {
      kind: 'reminder.fired', title: 'X', telegram: true,
    });
    expect(res.telegramOk).toBe(false);
    expect(telegramSendMock).not.toHaveBeenCalled();
  });

  it('Telegram send failure does NOT block in-app insert', async () => {
    telegramSendMock.mockRejectedValueOnce(new Error('Telegram down'));
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 555, web_user_id: 'wu_1' });
    const res = await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired',
      title: 'X',
      telegram: true,
      sourceSlug: 'reminders',
      sourceId: 'r_1:1',
    });
    expect(res.inappOk).toBe(true);
    expect(res.telegramOk).toBe(false);
    expect(res.ok).toBe(true);
    const rows = await readNotifications(ctx, 'wu_1');
    expect(rows).toHaveLength(1);
  });

  it('skips Telegram when ctx.bot is absent (botless tenant)', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    // ctx.bot intentionally not set
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 555, web_user_id: 'wu_1' });
    const res = await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired', title: 'X', telegram: true,
    });
    expect(res.telegramOk).toBe(false);
    expect(telegramSendMock).not.toHaveBeenCalled();
  });
});

describe('notifyWebUser — owner Telegram fallback (migration 0082)', () => {
  it('sends Telegram to a salon owner paired via web_users.telegram_chat_id (no master row)', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedWebUser(ctx, { id: 'wu_owner', tenant_id: 't_a', telegram_chat_id: 777, role: 'tenant_owner' });
    const res = await notifyWebUser(ctx, 'wu_owner', {
      kind: 'platform.campaign', title: 'Announcement', telegram: true,
    });
    expect(res.telegramOk).toBe(true);
    expect(telegramSendMock).toHaveBeenCalledWith(ctx, 777, expect.stringContaining('Announcement'));
  });

  it('prefers the non-synthetic master row over the owner pairing', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 555, web_user_id: 'wu_dual', is_synthetic: 0 });
    await seedWebUser(ctx, { id: 'wu_dual', tenant_id: 't_a', telegram_chat_id: 777 });
    await notifyWebUser(ctx, 'wu_dual', { kind: 'platform.campaign', title: 'X', telegram: true });
    expect(telegramSendMock).toHaveBeenCalledWith(ctx, 555, expect.anything());
  });

  it('falls back to owner pairing when the only master row is synthetic', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 10_000_000_123, web_user_id: 'wu_owner', is_synthetic: 1 });
    await seedWebUser(ctx, { id: 'wu_owner', tenant_id: 't_a', telegram_chat_id: 777 });
    const res = await notifyWebUser(ctx, 'wu_owner', { kind: 'platform.campaign', title: 'X', telegram: true });
    expect(res.telegramOk).toBe(true);
    expect(telegramSendMock).toHaveBeenCalledWith(ctx, 777, expect.anything());
  });

  it('skips owner Telegram when web_users.telegram_chat_id is null', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedWebUser(ctx, { id: 'wu_owner', tenant_id: 't_a', telegram_chat_id: null });
    const res = await notifyWebUser(ctx, 'wu_owner', { kind: 'platform.campaign', title: 'X', telegram: true });
    expect(res.telegramOk).toBe(false);
    expect(telegramSendMock).not.toHaveBeenCalled();
  });

  it('does not cross tenants — an owner chat in another tenant is not used', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedWebUser(ctx, { id: 'wu_owner', tenant_id: 't_b', telegram_chat_id: 777 });
    const res = await notifyWebUser(ctx, 'wu_owner', { kind: 'platform.campaign', title: 'X', telegram: true });
    expect(res.telegramOk).toBe(false);
    expect(telegramSendMock).not.toHaveBeenCalled();
  });
});

describe('notifyWebUser — formatting', () => {
  it('uses telegramText verbatim when provided', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 100, web_user_id: 'wu_1' });
    await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired', title: 'Short',
      telegram: true,
      telegramText: 'CUSTOM_TG_BODY',
    });
    expect(telegramSendMock).toHaveBeenCalledWith(ctx, 100, 'CUSTOM_TG_BODY');
  });

  it('derives default Telegram body when telegramText missing', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await seedMaster(ctx, { tenant_id: 't_a', chat_id: 100, web_user_id: 'wu_1' });
    await notifyWebUser(ctx, 'wu_1', {
      kind: 'reminder.fired', title: 'Hi', body: 'see ya',
      telegram: true,
    });
    expect(telegramSendMock).toHaveBeenCalledWith(ctx, 100, expect.stringContaining('🔔 Hi'));
    expect(telegramSendMock.mock.calls[0][2]).toContain('see ya');
  });
});
