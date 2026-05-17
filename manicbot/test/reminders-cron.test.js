/**
 * Reminders plugin cron handler — end-to-end behavior with a mocked D1.
 *
 * Critical invariants:
 *   - Occurrences inside the [-10min, +1min] window fire exactly once
 *     (idempotency via INSERT OR IGNORE on (reminder_id, fires_at_epoch)).
 *   - Re-invoking the handler with the same `now` is a no-op.
 *   - Archived reminders are skipped.
 *   - Target master with web_user_id → that user gets the in-app notification.
 *   - Target null → creator gets the in-app notification.
 *   - Telegram channel only fires when channels_json includes 'telegram'.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const telegramSendMock = vi.fn(async () => ({ ok: true }));
vi.mock('../src/telegram.js', () => ({
  send: (...args) => telegramSendMock(...args),
}));

const { remindersCron } = await import('../plugins/reminders/cron.js');

async function seedReminder(ctx, r) {
  await ctx.db.prepare(`
    INSERT INTO plugin_reminders
      (id, tenant_id, created_by_web_user_id, target_master_id, kind, title, note,
       starts_on, time, recurrence_json, channels_json, archived_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    r.id,
    r.tenant_id,
    r.created_by_web_user_id,
    r.target_master_id ?? null,
    r.kind ?? 'reminder',
    r.title,
    r.note ?? null,
    r.starts_on,
    r.time,
    r.recurrence_json,
    r.channels_json ?? '["inapp"]',
    r.archived_at ?? null,
    r.created_at ?? Math.floor(Date.now() / 1000),
    r.updated_at ?? Math.floor(Date.now() / 1000),
  ).run();
}

async function readFires(ctx, reminderId) {
  const rows = await ctx.db.prepare(
    `SELECT * FROM plugin_reminder_fires WHERE reminder_id = ?`,
  ).bind(reminderId).all();
  return rows.results;
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

describe('remindersCron — once-shot delivery', () => {
  it('fires a one-shot reminder whose anchor+time falls inside window', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    // Fire moment: 2026-05-18 09:00 UTC
    const nowMs = Date.UTC(2026, 4, 18, 9, 2); // 2 min after the fire time
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      title: 'Close register', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
    });
    const res = await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(res).toEqual({ fired: 1, skipped: 0 });
    const fires = await readFires(ctx, 'r1');
    expect(fires).toHaveLength(1);
    expect(fires[0].delivery_state).toBe('sent');
    const notifs = await readNotifications(ctx, 'wu_creator');
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toBe('Close register');
  });

  it('does not fire when anchor+time is outside the window', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const nowMs = Date.UTC(2026, 4, 18, 10, 30); // 1.5h after fire time, past window
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
    });
    const res = await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(res).toEqual({ fired: 0, skipped: 0 });
    expect(await readFires(ctx, 'r1')).toHaveLength(0);
  });

  it('is idempotent on repeated invocations at the same now', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const nowMs = Date.UTC(2026, 4, 18, 9, 1);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
    });
    await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    const second = await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    // skipped=1 = the idempotency claim short-circuited the second fire.
    expect(second).toEqual({ fired: 0, skipped: 1 });
    expect(await readFires(ctx, 'r1')).toHaveLength(1);
    expect(await readNotifications(ctx, 'wu_creator')).toHaveLength(1);
  });

  it('skips archived reminders', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const nowMs = Date.UTC(2026, 4, 18, 9, 1);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
      archived_at: Math.floor(Date.now() / 1000),
    });
    const res = await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(res).toEqual({ fired: 0, skipped: 0 });
    expect(await readFires(ctx, 'r1')).toHaveLength(0);
  });
});

describe('remindersCron — recurring', () => {
  it('fires only the occurrence(s) inside the window for weekly Mon/Wed/Fri', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    // 2026-05-18 is Monday. Window 08:50–09:01 around 09:00.
    const nowMs = Date.UTC(2026, 4, 18, 9, 0);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      title: 'Daily check', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({
        type: 'weekly', time: '09:00', weekdays: [1, 3, 5],
      }),
      kind: 'routine',
    });
    const res = await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(res.fired).toBe(1);
    expect(await readFires(ctx, 'r1')).toHaveLength(1);
  });

  it('weekly on Tue: Monday tick fires nothing', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    const nowMs = Date.UTC(2026, 4, 18, 9, 0); // Mon
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({
        type: 'weekly', time: '09:00', weekdays: [2], // Tue only
      }),
    });
    const res = await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(res.fired).toBe(0);
  });
});

describe('remindersCron — target resolution', () => {
  it('target_master_id → uses master.web_user_id', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await ctx.db.prepare(`
      INSERT INTO masters (tenant_id, chat_id, web_user_id, is_synthetic, name)
      VALUES (?, ?, ?, ?, ?)
    `).bind('t_a', 555, 'wu_master', 0, 'M').run();

    const nowMs = Date.UTC(2026, 4, 18, 9, 0);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_owner',
      target_master_id: 555,
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
    });
    await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    const masterNotifs = await readNotifications(ctx, 'wu_master');
    const ownerNotifs = await readNotifications(ctx, 'wu_owner');
    expect(masterNotifs).toHaveLength(1);
    expect(ownerNotifs).toHaveLength(0);
  });

  it('target_master_id missing → falls back to creator', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    // target_master_id=999 but no matching master row
    const nowMs = Date.UTC(2026, 4, 18, 9, 0);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_creator',
      target_master_id: 999,
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
    });
    await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(await readNotifications(ctx, 'wu_creator')).toHaveLength(1);
  });
});

describe('remindersCron — Telegram channel', () => {
  it('dispatches Telegram when channels_json includes "telegram" and master is non-synthetic', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await ctx.db.prepare(`
      INSERT INTO masters (tenant_id, chat_id, web_user_id, is_synthetic, name)
      VALUES (?, ?, ?, ?, ?)
    `).bind('t_a', 555, 'wu_master', 0, 'M').run();

    const nowMs = Date.UTC(2026, 4, 18, 9, 0);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_owner',
      target_master_id: 555,
      title: 'Tools', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
      channels_json: JSON.stringify(['inapp', 'telegram']),
    });
    await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(telegramSendMock).toHaveBeenCalledTimes(1);
    expect(telegramSendMock.mock.calls[0][1]).toBe(555);
  });

  it('does NOT dispatch Telegram when channels_json is in-app only', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.bot = { sendMessage: () => {} };
    await ctx.db.prepare(`
      INSERT INTO masters (tenant_id, chat_id, web_user_id, is_synthetic, name)
      VALUES (?, ?, ?, ?, ?)
    `).bind('t_a', 555, 'wu_master', 0, 'M').run();

    const nowMs = Date.UTC(2026, 4, 18, 9, 0);
    await seedReminder(ctx, {
      id: 'r1', tenant_id: 't_a', created_by_web_user_id: 'wu_owner',
      target_master_id: 555,
      title: 'X', starts_on: '2026-05-18', time: '09:00',
      recurrence_json: JSON.stringify({ type: 'once' }),
      channels_json: JSON.stringify(['inapp']),
    });
    await remindersCron(ctx, { tenant_id: 't_a' }, nowMs);
    expect(telegramSendMock).not.toHaveBeenCalled();
  });
});
