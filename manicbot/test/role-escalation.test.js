/**
 * Role escalation prevention tests.
 *
 * Verifies that role boundaries are enforced:
 * - master cannot access tenant_owner functions
 * - tenant_owner cannot access system_admin functions
 * - support cannot modify tenant data
 * - ADMIN_CHAT_ID always gets system_admin
 * - role changes are properly scoped per tenant
 */

import { describe, it, expect } from 'vitest';
import {
  isCreator,
  isAdmin,
  isPlatformAdmin,
  getRole,
  saveMaster,
  listMasters,
  getMaster,
  getUser,
  saveUser,
} from '../src/services/users.js';
import {
  resolveRole,
  setPlatformRole,
  setTenantRole,
  getTenantRole,
  getPlatformRole,
  ROLES,
  isSystemAdmin,
  isTenantOwner,
  isMaster,
  isSupport,
  isClient,
} from '../src/roles/roles.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx(opts = {}) {
  const db = opts.db || createMockD1();
  const kv = opts.kv || makeMockKv();
  return {
    db,
    kv,
    prefix: opts.prefix || `t:${opts.tenantId || 'test'}:`,
    tenantId: opts.tenantId || 'test',
    adminChatId: opts.adminChatId || null,
    ADMIN_CHAT_ID: opts.ADMIN_CHAT_ID || null,
  };
}

// ── ADMIN_CHAT_ID always gets system_admin ────────────────────────────────

describe('ADMIN_CHAT_ID always gets system_admin', () => {
  it('isCreator returns true for ADMIN_CHAT_ID regardless of DB state', () => {
    const ctx = { adminChatId: '12345' };
    expect(isCreator(ctx, 12345)).toBe(true);
    expect(isCreator(ctx, '12345')).toBe(true);
  });

  it('isCreator handles string/number comparison', () => {
    expect(isCreator({ adminChatId: '999' }, 999)).toBe(true);
    expect(isCreator({ adminChatId: 999 }, '999')).toBe(true);
  });

  it('isAdmin returns true for creator without any DB roles', async () => {
    const ctx = makeCtx({ adminChatId: '777' });
    expect(await isAdmin(ctx, 777)).toBe(true);
    expect(await isAdmin(ctx, '777')).toBe(true);
  });

  it('isPlatformAdmin returns true for creator even without DB', async () => {
    const ctx = { adminChatId: '321', db: null };
    expect(await isPlatformAdmin(ctx, 321)).toBe(true);
  });

  it('getRole returns system_admin for creator', async () => {
    const ctx = makeCtx({ adminChatId: '100' });
    expect(await getRole(ctx, 100)).toBe('system_admin');
  });

  it('creator always resolves to system_admin via getRole even when no DB roles exist', async () => {
    const ctx = makeCtx({ adminChatId: '50' });
    const role = await getRole(ctx, 50);
    expect(role).toBe('system_admin');
  });
});

// ── Master cannot access tenant_owner functions ───────────────────────────

describe('master cannot escalate to tenant_owner', () => {
  it('master role resolves as master, not tenant_owner', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setTenantRole(ctx, 200, ROLES.MASTER);
    const role = await resolveRole(ctx, 200);
    expect(role).toBe(ROLES.MASTER);
    expect(isMaster(role)).toBe(true);
    expect(isTenantOwner(role)).toBe(false);
  });

  it('isAdmin returns false for master', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setTenantRole(ctx, 200, ROLES.MASTER);
    expect(await isAdmin(ctx, 200)).toBe(false);
  });

  it('master getRole returns master, not admin', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setTenantRole(ctx, 300, ROLES.MASTER);
    const role = await getRole(ctx, 300);
    expect(role).toBe('master');
    expect(role).not.toBe('tenant_owner');
    expect(role).not.toBe('system_admin');
  });

  it('setTenantRole rejects invalid role names', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    const result = await setTenantRole(ctx, 200, 'system_admin');
    expect(result).toBe(false);
  });

  it('setTenantRole only accepts tenant_owner or master', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    expect(await setTenantRole(ctx, 200, ROLES.TENANT_OWNER)).toBe(true);
    expect(await setTenantRole(ctx, 201, ROLES.MASTER)).toBe(true);
    expect(await setTenantRole(ctx, 202, ROLES.SUPPORT)).toBe(false);
    expect(await setTenantRole(ctx, 203, ROLES.SYSTEM_ADMIN)).toBe(false);
    expect(await setTenantRole(ctx, 204, ROLES.CLIENT)).toBe(false);
    expect(await setTenantRole(ctx, 205, 'random_role')).toBe(false);
  });
});

// ── Tenant owner cannot access system_admin functions ─────────────────────

describe('tenant_owner cannot escalate to system_admin', () => {
  it('tenant_owner resolves as tenant_owner, not system_admin', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setTenantRole(ctx, 500, ROLES.TENANT_OWNER);
    const role = await resolveRole(ctx, 500);
    expect(role).toBe(ROLES.TENANT_OWNER);
    expect(isSystemAdmin(role)).toBe(false);
  });

  it('isPlatformAdmin returns false for tenant_owner', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setTenantRole(ctx, 500, ROLES.TENANT_OWNER);
    expect(await isPlatformAdmin(ctx, 500)).toBe(false);
  });

  it('tenant_owner getRole returns admin but not system_admin', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setTenantRole(ctx, 500, ROLES.TENANT_OWNER);
    const role = await getRole(ctx, 500);
    expect(role).toBe('tenant_owner');
    expect(role).not.toBe('system_admin');
  });

  it('setPlatformRole refuses system_admin assignment', async () => {
    const ctx = makeCtx();
    const result = await setPlatformRole(ctx, 999, ROLES.SYSTEM_ADMIN);
    expect(result).toBe(false);
    const stored = await getPlatformRole(ctx, 999);
    expect(stored).toBeNull();
  });
});

// ── Support cannot modify tenant data ─────────────────────────────────────

describe('support cannot modify tenant data', () => {
  it('support role resolves as support, not tenant_owner', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setPlatformRole(ctx, 600, ROLES.SUPPORT);
    const role = await resolveRole(ctx, 600);
    expect(role).toBe(ROLES.SUPPORT);
    expect(isSupport(role)).toBe(true);
    expect(isTenantOwner(role)).toBe(false);
    expect(isSystemAdmin(role)).toBe(false);
  });

  it('isAdmin returns false for support users', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setPlatformRole(ctx, 600, ROLES.SUPPORT);
    expect(await isAdmin(ctx, 600)).toBe(false);
  });

  it('getRole returns support for support users', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setPlatformRole(ctx, 700, ROLES.SUPPORT);
    const role = await getRole(ctx, 700);
    expect(role).toBe('support');
    expect(role).not.toBe('tenant_owner');
    expect(role).not.toBe('system_admin');
  });

  it('technical_support also cannot modify tenant data via isAdmin', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    await setPlatformRole(ctx, 800, ROLES.TECHNICAL_SUPPORT);
    expect(await isAdmin(ctx, 800)).toBe(false);
  });

  it('setPlatformRole only accepts support and technical_support', async () => {
    const ctx = makeCtx();
    expect(await setPlatformRole(ctx, 10, ROLES.SUPPORT)).toBe(true);
    expect(await setPlatformRole(ctx, 11, ROLES.TECHNICAL_SUPPORT)).toBe(true);
    expect(await setPlatformRole(ctx, 12, ROLES.SYSTEM_ADMIN)).toBe(false);
    expect(await setPlatformRole(ctx, 13, ROLES.TENANT_OWNER)).toBe(false);
    expect(await setPlatformRole(ctx, 14, ROLES.MASTER)).toBe(false);
    expect(await setPlatformRole(ctx, 15, ROLES.CLIENT)).toBe(false);
  });
});

// ── Role changes properly scoped per tenant ───────────────────────────────

describe('role changes are properly scoped per tenant', () => {
  it('tenant role in tenant A is not visible from tenant B', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:t_a:', tenantId: 't_a', adminChatId: null };
    const ctxB = { db, kv, prefix: 't:t_b:', tenantId: 't_b', adminChatId: null };

    await setTenantRole(ctxA, 1000, ROLES.TENANT_OWNER);
    expect(await getTenantRole(ctxA, 1000)).toBe(ROLES.TENANT_OWNER);
    expect(await getTenantRole(ctxB, 1000)).toBeNull();
  });

  it('same user can have different roles in different tenants', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:t_a:', tenantId: 't_a', adminChatId: null };
    const ctxB = { db, kv, prefix: 't:t_b:', tenantId: 't_b', adminChatId: null };

    await setTenantRole(ctxA, 2000, ROLES.TENANT_OWNER);
    await setTenantRole(ctxB, 2000, ROLES.MASTER);

    expect(await getTenantRole(ctxA, 2000)).toBe(ROLES.TENANT_OWNER);
    expect(await getTenantRole(ctxB, 2000)).toBe(ROLES.MASTER);

    const roleA = await resolveRole(ctxA, 2000);
    const roleB = await resolveRole(ctxB, 2000);
    expect(roleA).toBe(ROLES.TENANT_OWNER);
    expect(roleB).toBe(ROLES.MASTER);
  });

  it('platform role is visible across all tenants', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:t_a:', tenantId: 't_a', adminChatId: null };
    const ctxB = { db, kv, prefix: 't:t_b:', tenantId: 't_b', adminChatId: null };

    await setPlatformRole(ctxA, 3000, ROLES.SUPPORT);
    const roleA = await resolveRole(ctxA, 3000);
    const roleB = await resolveRole(ctxB, 3000);
    expect(roleA).toBe(ROLES.SUPPORT);
    expect(roleB).toBe(ROLES.SUPPORT);
  });

  it('user without any role resolves to client', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    const role = await resolveRole(ctx, 9999);
    expect(role).toBe(ROLES.CLIENT);
    expect(isClient(role)).toBe(true);
  });

  it('stale system_admin row in platform_roles without matching ADMIN_CHAT_ID is ignored', async () => {
    const ctx = makeCtx({ adminChatId: '111' });
    // Manually insert a system_admin row for user 222 (not the creator)
    await ctx.db.prepare(
      'INSERT OR REPLACE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)',
    ).bind(222, 'system_admin', Date.now()).run();

    // User 222 has system_admin in DB but is NOT the ADMIN_CHAT_ID
    const role = await resolveRole(ctx, 222);
    expect(role).not.toBe(ROLES.SYSTEM_ADMIN);
    expect(role).toBe(ROLES.CLIENT);
  });
});

// ── Role helper functions ─────────────────────────────────────────────────

describe('role helper functions', () => {
  it('isSystemAdmin only for system_admin', () => {
    expect(isSystemAdmin('system_admin')).toBe(true);
    expect(isSystemAdmin('support')).toBe(false);
    expect(isSystemAdmin('tenant_owner')).toBe(false);
    expect(isSystemAdmin('master')).toBe(false);
    expect(isSystemAdmin('client')).toBe(false);
  });

  it('isSupport for support and technical_support', () => {
    expect(isSupport('support')).toBe(true);
    expect(isSupport('technical_support')).toBe(true);
    expect(isSupport('system_admin')).toBe(false);
    expect(isSupport('tenant_owner')).toBe(false);
    expect(isSupport('master')).toBe(false);
  });

  it('isTenantOwner only for tenant_owner', () => {
    expect(isTenantOwner('tenant_owner')).toBe(true);
    expect(isTenantOwner('system_admin')).toBe(false);
    expect(isTenantOwner('master')).toBe(false);
  });

  it('isMaster only for master', () => {
    expect(isMaster('master')).toBe(true);
    expect(isMaster('tenant_owner')).toBe(false);
    expect(isMaster('support')).toBe(false);
  });

  it('isClient only for client', () => {
    expect(isClient('client')).toBe(true);
    expect(isClient('master')).toBe(false);
    expect(isClient('support')).toBe(false);
  });
});

// ── Web session lock prevents escalation ──────────────────────────────────

describe('web session lock prevents role escalation', () => {
  it('isAdmin returns false for locked web session even if user has admin row', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    ctx._lockToClientRole = true;
    ctx._webSessionChatId = 400;
    await setTenantRole(ctx, 400, ROLES.TENANT_OWNER);
    expect(await isAdmin(ctx, 400)).toBe(false);
  });

  it('getRole returns client for locked web session even if user has tenant_owner role', async () => {
    const ctx = makeCtx({ tenantId: 't_salon' });
    ctx._lockToClientRole = true;
    ctx._webSessionChatId = 401;
    await setTenantRole(ctx, 401, ROLES.TENANT_OWNER);
    expect(await getRole(ctx, 401)).toBe('client');
  });

  it('isPlatformAdmin returns false for locked web session even for creator', async () => {
    const ctx = makeCtx({ adminChatId: '402' });
    ctx._lockToClientRole = true;
    ctx._webSessionChatId = 402;
    expect(await isPlatformAdmin(ctx, 402)).toBe(false);
  });
});

// ── Edge cases ported from the deleted roles-users.test.js ─────────────────
// (Phase 2 cleanup — kept the unique negative-edge assertions; the positive
// happy-path cases were already covered above.)

describe('isCreator — negative edge cases', () => {
  it('returns false when cid differs', () => {
    expect(isCreator({ adminChatId: '12345' }, 999)).toBe(false);
    expect(isCreator({ adminChatId: '12345' }, null)).toBe(false);
  });

  it('returns false when adminChatId is missing or null', () => {
    expect(isCreator({}, 12345)).toBe(false);
    expect(isCreator({ adminChatId: null }, 12345)).toBe(false);
  });

  it('returns false when cid is null or undefined', () => {
    expect(isCreator({ adminChatId: '12345' }, null)).toBe(false);
    expect(isCreator({ adminChatId: '12345' }, undefined)).toBe(false);
  });
});

describe('isPlatformAdmin — non-creator without DB', () => {
  it('non-creator without db is not platform admin', async () => {
    const ctx = { adminChatId: '777', db: null };
    expect(await isPlatformAdmin(ctx, 888)).toBe(false);
  });
});

// ── Merged from role-master-tenant.test.js (Phase 2 cleanup) ───────────────

const _phase2MasterData = {
  chatId: 111,
  name: 'Test',
  tgUsername: null,
  phone: null,
  addedAt: Date.now(),
  active: true,
};

describe('Master assignment — tenant isolation (D1)', () => {
  it('masters are stored under tenant (listMasters only sees own tenant)', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveMaster(ctx1, 100, { ..._phase2MasterData, chatId: 100, name: 'Salon1' });
    await saveMaster(ctx2, 200, { ..._phase2MasterData, chatId: 200, name: 'Salon2' });
    const list1 = await listMasters(ctx1);
    const list2 = await listMasters(ctx2);
    expect(list1).toHaveLength(1);
    expect(list2).toHaveLength(1);
    expect(list1[0].name).toBe('Salon1');
    expect(list2[0].name).toBe('Salon2');
  });

  it('getMaster in tenant A does not see master record from tenant B', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveMaster(ctx1, 333, { ..._phase2MasterData, chatId: 333, name: 'OnlyInA' });
    expect(await getMaster(ctx1, 333)).not.toBeNull();
    expect(await getMaster(ctx2, 333)).toBeNull();
  });

  it('same chatId can be master in two different tenants', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx1 = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctx2 = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveMaster(ctx1, 555, { ..._phase2MasterData, chatId: 555, name: 'Multi' });
    await saveMaster(ctx2, 555, { ..._phase2MasterData, chatId: 555, name: 'Multi' });
    expect(await listMasters(ctx1)).toHaveLength(1);
    expect(await listMasters(ctx2)).toHaveLength(1);
  });
});

describe('User-in-tenant requirement (D1)', () => {
  function makeTenantCtx(tenantId = 't_salon1') {
    const db = createMockD1();
    const kv = makeMockKv();
    return { db, kv, prefix: `t:${tenantId}:`, tenantId };
  }

  it('getUser returns null for chatId with no record in this tenant', async () => {
    const ctx = makeTenantCtx();
    expect(await getUser(ctx, 12345)).toBeNull();
  });

  it('getUser returns user when record exists in this tenant', async () => {
    const ctx = makeTenantCtx();
    await saveUser(ctx, 999, { chatId: 999, name: 'Alice', tgUsername: 'alice' });
    const u = await getUser(ctx, 999);
    expect(u).not.toBeNull();
    expect(u.name).toBe('Alice');
  });

  it('user in tenant A is not visible to tenant B getUser', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:t_salon1:', tenantId: 't_salon1' };
    const ctxB = { db, kv, prefix: 't:t_salon2:', tenantId: 't_salon2' };
    await saveUser(ctxA, 777, { chatId: 777, name: 'Bob' });
    expect(await getUser(ctxA, 777)).not.toBeNull();
    expect(await getUser(ctxB, 777)).toBeNull();
  });
});
