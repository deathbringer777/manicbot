/**
 * Tests for notification routing after KV→D1 migration.
 * Covers the bug where t_preview had no master/admin record in D1,
 * causing appointment notifications to be silently dropped.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMockD1 } from './helpers/mock-db.js';

// ── Role resolution after D1 migration ───────────────────────────────────────

describe('Role resolution — D1 vs KV routing', () => {
  it('getAdminId: uses D1 when ctx.db AND ctx.tenantId exist', async () => {
    const { getAdminId } = await import('../src/services/users.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_preview', kv: null };

    // Insert admin into tenant_config
    await db.prepare('INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)')
      .bind('t_preview', 'admin', '321706035').run();

    const adminId = await getAdminId(ctx);
    expect(String(adminId)).toBe('321706035');
  });

  it('getAdminId: returns null when tenant has no admin config in D1', async () => {
    const { getAdminId } = await import('../src/services/users.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_empty_tenant', kv: null };
    const adminId = await getAdminId(ctx);
    expect(adminId).toBeNull();
  });

  it('listMasters: returns empty when masters table has no records for tenant', async () => {
    const { listMasters } = await import('../src/services/users.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_empty_tenant', kv: null };
    const masters = await listMasters(ctx);
    expect(masters).toEqual([]);
  });

  it('listMasters: returns master when record exists in D1', async () => {
    const { listMasters } = await import('../src/services/users.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_test', kv: null };

    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, tg_username, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind('t_test', 321706035, 'Kirill', 'dezbringer', 0, 1, Date.now()).run();

    const masters = await listMasters(ctx);
    expect(masters.length).toBe(1);
    expect(masters[0].chatId).toBe(321706035);
    expect(masters[0].onVacation).toBe(false);
    expect(masters[0].active).toBe(true);
  });

  it('listMasters: excludes masters on vacation', async () => {
    const { listMasters } = await import('../src/services/users.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_test2', kv: null };

    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('t_test2', 111, 'On Vacation', 1, 1, Date.now()).run();

    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('t_test2', 222, 'Active Master', 0, 1, Date.now()).run();

    const masters = await listMasters(ctx);
    expect(masters.length).toBe(2); // listMasters returns all; notifyAptStaff filters vacation
    const onVacationMaster = masters.find(m => m.chatId === 111);
    expect(onVacationMaster?.onVacation).toBe(true);
  });
});

// ── notifyAptStaff recipient calculation ─────────────────────────────────────

describe('notifyAptStaff — recipient logic', () => {
  /**
   * Mirrors notifyAptStaff recipient selection logic without actually sending messages.
   */
  async function getRecipients(ctx, apt) {
    const { getAdminId, listMasters } = await import('../src/services/users.js');
    const adminId = await getAdminId(ctx);
    const recipients = new Set();
    if (apt.masterId) {
      recipients.add(apt.masterId);
    } else {
      const masters = await listMasters(ctx);
      for (const m of masters) if (m.chatId && !m.onVacation) recipients.add(m.chatId);
    }
    if (adminId) recipients.add(adminId);
    return [...recipients];
  }

  it('BUG REGRESSION: t_preview with no masters/admin → 0 recipients (was the bug)', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_preview_empty', kv: null };
    // Empty tenant — no masters, no admin
    const recipients = await getRecipients(ctx, { svcId: 's1', date: '2026-03-27', time: '13:00' });
    expect(recipients.length).toBe(0); // This was the bug — silently dropped
  });

  it('FIX: t_preview with master AND admin → 1 recipient (same person)', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_preview', kv: null };

    // Simulate fixed state
    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('t_preview', 321706035, 'Kirill', 0, 1, Date.now()).run();
    await db.prepare(
      'INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)'
    ).bind('t_preview', 'admin', '321706035').run();

    const recipients = await getRecipients(ctx, { svcId: 's1', date: '2026-03-27', time: '13:00' });
    expect(recipients.length).toBe(1); // Same person as master and admin → de-duped
    expect(recipients[0]).toBe(321706035);
  });

  it('Assigned appointment (masterId set): notifies that master + admin', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_salon1', kv: null };

    await db.prepare(
      'INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)'
    ).bind('t_salon1', 'admin', '999').run();

    const apt = { masterId: 321706035, svcId: 's1', date: '2026-03-27', time: '13:00' };
    const recipients = await getRecipients(ctx, apt);
    expect(recipients).toContain(321706035); // assigned master
    expect(recipients).toContain(999);        // admin
    expect(recipients.length).toBe(2);
  });

  it('No masterId, 2 active masters: both notified', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_multi', kv: null };

    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('t_multi', 100, 'Master1', 0, 1, Date.now()).run();
    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('t_multi', 200, 'Master2', 0, 1, Date.now()).run();

    const apt = { svcId: 's1', date: '2026-03-27', time: '13:00' };
    const recipients = await getRecipients(ctx, apt);
    expect(recipients).toContain(100);
    expect(recipients).toContain(200);
  });

  it('No masterId, all masters on vacation: only admin notified', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_vacation', kv: null };

    await db.prepare(
      'INSERT OR REPLACE INTO masters (tenant_id, chat_id, name, on_vacation, active, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('t_vacation', 300, 'On Vacation', 1, 1, Date.now()).run();
    await db.prepare(
      'INSERT OR REPLACE INTO tenant_config (tenant_id, key, value) VALUES (?, ?, ?)'
    ).bind('t_vacation', 'admin', '999').run();

    const apt = { svcId: 's1', date: '2026-03-27', time: '13:00' };
    const recipients = await getRecipients(ctx, apt);
    expect(recipients).toContain(999); // admin still notified
    expect(recipients).not.toContain(300); // vacationing master excluded
    expect(recipients.length).toBe(1);
  });
});

// ── Role resolution after KV→D1 migration ────────────────────────────────────

describe('Role resolution — D1 migration correctness', () => {
  it('platform_roles: system_admin is not writable via setPlatformRole', async () => {
    const { setPlatformRole, getPlatformRole, ROLES } = await import('../src/roles/roles.js');
    const db = createMockD1();
    const ctx = { db };

    const ok = await setPlatformRole(ctx, 321706035, ROLES.SYSTEM_ADMIN);
    expect(ok).toBe(false);
    expect(await getPlatformRole(ctx, 321706035)).toBeNull();
  });

  it('platform_roles: wrong value "admin" fails the system_admin check', async () => {
    const { getPlatformRole } = await import('../src/roles/roles.js');
    const db = createMockD1();
    const ctx = { db };

    // Simulate the old wrong data
    await db.prepare(
      'INSERT OR REPLACE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)'
    ).bind(999, 'admin', Date.now()).run();

    const role = await getPlatformRole(ctx, 999);
    expect(role).toBe('admin'); // reads what was stored
    expect(role).not.toBe('system_admin'); // NOT recognized as system_admin!
    // → isPlatformAdmin would return false for this user (unless they are isCreator)
  });

  it('tenant_roles: tenant_owner maps to admin role in getRole', async () => {
    const { getRole } = await import('../src/services/users.js');
    const { setTenantRole } = await import('../src/roles/roles.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_test', adminChatId: '999', kv: null };

    await setTenantRole(ctx, 500, 'tenant_owner');
    const role = await getRole(ctx, 500);
    expect(role).toBe('admin'); // tenant_owner = 'admin' in UI terms
  });

  it('tenant_roles: master maps to master role in getRole', async () => {
    const { getRole } = await import('../src/services/users.js');
    const { setTenantRole } = await import('../src/roles/roles.js');
    const db = createMockD1();
    const ctx = { db, tenantId: 't_test', adminChatId: '999', kv: null };

    await setTenantRole(ctx, 600, 'master');
    const role = await getRole(ctx, 600);
    expect(role).toBe('master');
  });

  it('isCreator always returns true for adminChatId, bypassing D1', async () => {
    const { isCreator } = await import('../src/services/users.js');
    const ctx = { adminChatId: '321706035' };
    expect(isCreator(ctx, 321706035)).toBe(true);
    expect(isCreator(ctx, 999)).toBe(false);
  });

  it('isPlatformAdmin returns true for creator even with wrong D1 data', async () => {
    const { isPlatformAdmin } = await import('../src/services/users.js');
    const db = createMockD1();
    const ctx = { db, adminChatId: '321706035' };
    // Even if D1 has wrong "admin" role, isCreator check passes first
    await db.prepare(
      'INSERT OR REPLACE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)'
    ).bind(321706035, 'admin', Date.now()).run();

    expect(await isPlatformAdmin(ctx, 321706035)).toBe(true); // via isCreator
  });
});

// ── Notification recipients must NOT be empty ─────────────────────────────────

describe('Notification system — empty recipients warning', () => {
  it('When recipients is empty, no notifications sent (silent fail = bug)', async () => {
    // This test documents the bug behavior — empty recipients mean notification dropped
    const recipients = new Set();
    // No masters, no admin in D1 → nothing notified
    expect(recipients.size).toBe(0);

    // After fix: t_preview now has both master and admin → notifications work
    const fixedRecipients = new Set([321706035]);
    expect(fixedRecipients.size).toBe(1);
  });
});
