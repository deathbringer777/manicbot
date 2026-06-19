/**
 * Worker-side notification writers added in PR2 of the Notification
 * Center upgrade.
 *
 * Locks:
 *   - notifyAptStaff also writes user_notifications for tenant_owner +
 *     assigned non-synthetic master (kind = 'appointment.created').
 *   - notifyAptStaffAutoConfirmed writes 'appointment.confirmed' for
 *     the same targets.
 *   - birthday cron writes 'birthday.client' for tenant_owner.
 *
 * Synthetic personal-master rows (is_synthetic=1) are NOT in-app
 * targets — that's a real Telegram-only path for self-registered
 * personal-tenant masters and they can't have a separate "salon
 * owner" view of the bell.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

// Telegram sends are not what we're testing — silence them.
const telegramSendMock = vi.fn(async () => ({ ok: true }));
vi.mock('../src/telegram.js', () => ({
  send: (...args) => telegramSendMock(...args),
  sendIcs: vi.fn(async () => ({ ok: true })),
}));

// Other heavy-side-effect modules used by notifications.js — stub.
vi.mock('../src/services/google-calendar-oauth.js', () => ({
  syncAppointmentCalendar: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../src/services/chat.js', () => ({
  getLang: vi.fn(async () => 'ru'),
}));
vi.mock('../src/services/users.js', () => ({
  listMasters: vi.fn(async () => []),
  getAdminId: vi.fn(async () => null),
  getUser: vi.fn(async () => null),
  canManageApt: vi.fn(async () => true),
  // 0074 — notifyAptStaff (and its auto-confirmed sibling) now route
  // through this helper to prefer a master's real Telegram chat over the
  // synthetic >=10B identity. Each test seeds masters via the DB; the
  // helper just reads `telegramChatId` / `chatId` off whichever object
  // the SUT passes in, so the real implementation is safe here — but
  // since we mock the whole module, the import sees `undefined` without
  // an explicit export. Re-exporting the real helper keeps behaviour
  // identical to production for the in-app bell fan-out tests.
  masterTelegramRecipient: (master) => {
    if (!master) return null;
    const tg = master.telegramChatId ?? master.telegram_chat_id ?? null;
    if (tg) return Number(tg);
    const cid = Number(master.chatId);
    if (Number.isFinite(cid) && cid > 0 && cid < 10_000_000_000) return cid;
    return null;
  },
}));

const { notifyAptStaff, notifyAptStaffAutoConfirmed } = await import('../src/notifications.js');

async function seedOwner(ctx, tenantId, webUserId) {
  await ctx.db.prepare(
    `INSERT INTO web_users (id, email, password_hash, tenant_id, role, email_verified, login_attempts, password_changed_at, sessions_invalidated_at, lang)
     VALUES (?, ?, '', ?, 'tenant_owner', 1, 0, 0, 0, 'ru')`,
  ).bind(webUserId, `${webUserId}@test.com`, tenantId).run();
}

async function seedMaster(ctx, tenantId, chatId, webUserId, isSynthetic = 0) {
  await ctx.db.prepare(
    `INSERT INTO masters (tenant_id, chat_id, web_user_id, is_synthetic, name)
     VALUES (?, ?, ?, ?, 'M')`,
  ).bind(tenantId, chatId, webUserId, isSynthetic).run();
}

async function readNotifications(ctx, webUserId) {
  const rows = await ctx.db.prepare(
    `SELECT * FROM user_notifications WHERE web_user_id = ? ORDER BY created_at`,
  ).bind(webUserId).all();
  return rows.results;
}

beforeEach(() => {
  telegramSendMock.mockReset();
  telegramSendMock.mockResolvedValue({ ok: true });
});

describe('notifyAptStaff → appointment.created in-app fan-out', () => {
  it('writes a bell row for the tenant owner AND the assigned non-synthetic master', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.svc = [{ id: 'manicure', name: 'Маникюр', price: 100, dur: 60 }];

    await seedOwner(ctx, 't_a', 'wu_owner');
    await seedMaster(ctx, 't_a', 555, 'wu_master', 0);

    const apt = {
      id: 'apt_1',
      tenantId: 't_a',
      chatId: 999,
      masterId: 555,
      svcId: 'manicure',
      date: '2026-05-18',
      time: '14:00',
      userName: 'Анна',
      userPhone: '+48123456789',
    };
    await notifyAptStaff(ctx, apt, { name: 'Анна', phone: '+48123456789' });

    const ownerRows = await readNotifications(ctx, 'wu_owner');
    const masterRows = await readNotifications(ctx, 'wu_master');

    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]).toMatchObject({
      kind: 'appointment.created',
      title: 'Новая запись',
      source_slug: 'appointment',
      source_id: 'apt_1:appointment.created',
    });
    expect(ownerRows[0].body).toContain('Анна');
    // svcName falls back to the svcId when i18n isn't loaded — accept either.
    expect(ownerRows[0].body).toMatch(/Маникюр|manicure/i);
    // Link must anchor at the in-app home (/dashboard), NOT root "/" — a root
    // link sends the user to the marketing landing page (src/http/adminAppProxy.js
    // does not proxy "/" to admin-app).
    expect(ownerRows[0].link).toContain('/dashboard?tab=appointments');
    expect(ownerRows[0].link).toContain('apt_1');
    expect(ownerRows[0].link.startsWith('/?')).toBe(false);

    expect(masterRows).toHaveLength(1);
    expect(masterRows[0].kind).toBe('appointment.created');
  });

  it('skips synthetic masters as bell targets', async () => {
    const ctx = makeCtx({ tenantId: 't_b' });
    ctx.svc = [{ id: 'mani', name: 'Маникюр', price: 100 }];
    await seedOwner(ctx, 't_b', 'wu_owner_b');
    await seedMaster(ctx, 't_b', 10000000001, 'wu_personal', 1);

    const apt = { id: 'apt_2', tenantId: 't_b', masterId: 10000000001, svcId: 'mani', date: '2026-05-18', time: '10:00', userName: 'Mila', userPhone: '+1' };
    await notifyAptStaff(ctx, apt, { name: 'Mila' });

    const ownerRows = await readNotifications(ctx, 'wu_owner_b');
    const personalRows = await readNotifications(ctx, 'wu_personal');
    expect(ownerRows).toHaveLength(1);
    expect(personalRows).toHaveLength(0);
  });

  it('is idempotent on retry — same (apt, kind) collapses via uq_user_notifications_source', async () => {
    const ctx = makeCtx({ tenantId: 't_c' });
    ctx.svc = [{ id: 'mani', name: 'Маникюр', price: 100 }];
    await seedOwner(ctx, 't_c', 'wu_owner_c');

    const apt = { id: 'apt_3', tenantId: 't_c', svcId: 'mani', date: '2026-05-18', time: '10:00', userName: 'X' };
    await notifyAptStaff(ctx, apt, { name: 'X' });
    await notifyAptStaff(ctx, apt, { name: 'X' });

    const rows = await readNotifications(ctx, 'wu_owner_c');
    expect(rows).toHaveLength(1); // dedup'd
  });

  it('does nothing when tenant has no web-linked recipients', async () => {
    const ctx = makeCtx({ tenantId: 't_empty' });
    ctx.svc = [{ id: 'mani', name: 'Маникюр', price: 100 }];
    // No owner, no master — only Telegram fan-out would happen.

    const apt = { id: 'apt_x', tenantId: 't_empty', svcId: 'mani', date: '2026-05-18', time: '10:00', userName: 'X' };
    await expect(notifyAptStaff(ctx, apt, {})).resolves.toBeUndefined();
  });
});

describe('notifyAptStaffAutoConfirmed → appointment.confirmed in-app', () => {
  it('writes a bell row tagged appointment.confirmed', async () => {
    const ctx = makeCtx({ tenantId: 't_d' });
    ctx.svc = [{ id: 'mani', name: 'Маникюр', price: 100 }];
    await seedOwner(ctx, 't_d', 'wu_owner_d');

    const apt = { id: 'apt_d', tenantId: 't_d', svcId: 'mani', date: '2026-05-18', time: '15:00', userName: 'Y' };
    await notifyAptStaffAutoConfirmed(ctx, apt, { name: 'Y' });

    const rows = await readNotifications(ctx, 'wu_owner_d');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'appointment.confirmed',
      title: 'Запись подтверждена',
      source_id: 'apt_d:appointment.confirmed',
    });
  });
});
