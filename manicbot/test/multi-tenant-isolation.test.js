/**
 * Multi-tenant data isolation tests.
 *
 * Verifies:
 * - KV key prefixes prevent cross-tenant data access
 * - D1 queries are always scoped to tenantId
 * - buildTenantCtx correctly isolates tenants
 * - Legacy vs D1 context resolution
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { kvGet, kvPut, kvDel, kvListAll } from '../src/utils/kv.js';
import { saveMaster, listMasters, getMaster } from '../src/services/users.js';
import { getUser, saveUser, blockUser, isBlocked, unblockUser } from '../src/services/users.js';
import { saveApt, getApts } from '../src/services/appointments.js';
import { setTenantRole, getTenantRole, ROLES } from '../src/roles/roles.js';
import {
  buildTenantCtx,
  buildLegacyCtx,
  resolveTenantFromBotId,
} from '../src/tenant/resolver.js';
import { putTenant, putBot } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { warsawToUTC } from '../src/utils/date.js';

// ── KV key prefix isolation ───────────────────────────────────────────────

describe('KV key prefixes prevent cross-tenant data access', () => {
  it('kvPut scopes keys under ctx.prefix', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctxA = { kv, prefix: 't:salon_a:' };
    const ctxB = { kv, prefix: 't:salon_b:' };

    await kvPut(ctxA, 'setting', { color: 'blue' });
    await kvPut(ctxB, 'setting', { color: 'red' });

    // Each tenant gets its own value
    expect(await kvGet(ctxA, 'setting')).toEqual({ color: 'blue' });
    expect(await kvGet(ctxB, 'setting')).toEqual({ color: 'red' });
  });

  it('kvGet cannot read another tenant prefix', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctxA = { kv, prefix: 't:salon_a:' };
    const ctxB = { kv, prefix: 't:salon_b:' };

    await kvPut(ctxA, 'secret', { value: 'hidden' });
    // Tenant B cannot see tenant A's data
    expect(await kvGet(ctxB, 'secret')).toBeNull();
  });

  it('kvListAll only returns keys within ctx.prefix', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctxA = { kv, prefix: 't:salon_a:' };
    const ctxB = { kv, prefix: 't:salon_b:' };

    await kvPut(ctxA, 'u:1', { name: 'Alice' });
    await kvPut(ctxA, 'u:2', { name: 'Bob' });
    await kvPut(ctxB, 'u:3', { name: 'Carol' });

    const keysA = await kvListAll(ctxA, { prefix: 'u:' });
    const keysB = await kvListAll(ctxB, { prefix: 'u:' });

    expect(keysA).toHaveLength(2);
    expect(keysB).toHaveLength(1);
    expect(keysA.map(k => k.name)).toEqual(expect.arrayContaining(['u:1', 'u:2']));
    expect(keysB.map(k => k.name)).toEqual(['u:3']);
  });

  it('kvDel only removes keys within own prefix', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctxA = { kv, prefix: 't:salon_a:' };
    const ctxB = { kv, prefix: 't:salon_b:' };

    await kvPut(ctxA, 'temp', { a: 1 });
    await kvPut(ctxB, 'temp', { b: 2 });

    await kvDel(ctxA, 'temp');
    expect(await kvGet(ctxA, 'temp')).toBeNull();
    expect(await kvGet(ctxB, 'temp')).toEqual({ b: 2 });
  });

  it('different prefix formats (t: vs b:) are completely isolated', async () => {
    const store = new Map();
    const kv = makeMockKv(store);
    const ctxTenant = { kv, prefix: 't:default:' };
    const ctxLegacy = { kv, prefix: 'b:12345:' };

    await kvPut(ctxTenant, 'cfg:admin', '111');
    await kvPut(ctxLegacy, 'cfg:admin', '222');

    expect(await kvGet(ctxTenant, 'cfg:admin')).toBe('111');
    expect(await kvGet(ctxLegacy, 'cfg:admin')).toBe('222');
  });
});

// ── D1 queries scoped to tenantId ─────────────────────────────────────────

describe('D1 queries are always scoped to tenantId', () => {
  it('users in tenant A are not visible from tenant B', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a' };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b' };

    await saveUser(ctxA, 100, { chatId: 100, name: 'TenantA User' });
    await saveUser(ctxB, 200, { chatId: 200, name: 'TenantB User' });

    expect(await getUser(ctxA, 100)).not.toBeNull();
    expect(await getUser(ctxA, 200)).toBeNull();
    expect(await getUser(ctxB, 200)).not.toBeNull();
    expect(await getUser(ctxB, 100)).toBeNull();
  });

  it('masters in tenant A are isolated from tenant B', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a' };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b' };

    await saveMaster(ctxA, 300, { chatId: 300, name: 'MasterA', active: true });
    await saveMaster(ctxB, 400, { chatId: 400, name: 'MasterB', active: true });

    const mastersA = await listMasters(ctxA);
    const mastersB = await listMasters(ctxB);

    expect(mastersA).toHaveLength(1);
    expect(mastersA[0].name).toBe('MasterA');
    expect(mastersB).toHaveLength(1);
    expect(mastersB[0].name).toBe('MasterB');
  });

  it('getMaster in wrong tenant returns null', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a' };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b' };

    await saveMaster(ctxA, 500, { chatId: 500, name: 'OnlyInA', active: true });

    expect(await getMaster(ctxA, 500)).not.toBeNull();
    expect(await getMaster(ctxB, 500)).toBeNull();
  });

  it('blocked users are scoped per tenant', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a' };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b' };

    await blockUser(ctxA, 600);

    expect(await isBlocked(ctxA, 600)).toBe(true);
    expect(await isBlocked(ctxB, 600)).toBe(false);
  });

  it('unblocking in one tenant does not affect another', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a' };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b' };

    await blockUser(ctxA, 700);
    await blockUser(ctxB, 700);

    await unblockUser(ctxA, 700);

    expect(await isBlocked(ctxA, 700)).toBe(false);
    expect(await isBlocked(ctxB, 700)).toBe(true);
  });

  it('tenant roles are scoped per tenant', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a', adminChatId: null };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b', adminChatId: null };

    await setTenantRole(ctxA, 800, ROLES.TENANT_OWNER);

    expect(await getTenantRole(ctxA, 800)).toBe(ROLES.TENANT_OWNER);
    expect(await getTenantRole(ctxB, 800)).toBeNull();
  });

  it('same chatId can have different tenant roles in different tenants', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = { db, kv, prefix: 't:salon_a:', tenantId: 'salon_a', adminChatId: null };
    const ctxB = { db, kv, prefix: 't:salon_b:', tenantId: 'salon_b', adminChatId: null };

    await setTenantRole(ctxA, 900, ROLES.TENANT_OWNER);
    await setTenantRole(ctxB, 900, ROLES.MASTER);

    expect(await getTenantRole(ctxA, 900)).toBe(ROLES.TENANT_OWNER);
    expect(await getTenantRole(ctxB, 900)).toBe(ROLES.MASTER);
  });
});

// ── buildTenantCtx correctly isolates tenants ─────────────────────────────

describe('buildTenantCtx correctly isolates tenants', () => {
  const baseEnv = {
    MANICBOT: null,
    DB: null,
    BOT_TOKEN: '12345:AAxxx',
    ADMIN_KEY: 'adm',
    WEBHOOK_SECRET: 'wh',
    ADMIN_CHAT_ID: null,
    AI: null,
    WORKERS_AI_API_TOKEN: null,
    CLOUDFLARE_ACCOUNT_ID: null,
  };

  let env;

  beforeEach(() => {
    const db = createMockD1();
    const kv = makeMockKv();
    env = { ...baseEnv, MANICBOT: kv, DB: db };
  });

  it('sets correct prefix for tenant context: t:{tenantId}:', () => {
    const resolved = {
      tenantId: 'my_salon',
      tenant: { id: 'my_salon', name: 'My Salon' },
      bot: { botId: '111', botToken: '111:tok', webhookSecret: 'ws' },
      TG: 'https://api.telegram.org/bot111:tok',
    };
    const ctx = buildTenantCtx(env, resolved);
    expect(ctx.prefix).toBe('t:my_salon:');
    expect(ctx.tenantId).toBe('my_salon');
  });

  it('tenant context has db and kv from env', () => {
    const resolved = {
      tenantId: 'test',
      tenant: { id: 'test', name: 'Test' },
      bot: { botId: '222', botToken: 'x', webhookSecret: 'y' },
      TG: 'https://api.telegram.org/botx',
    };
    const ctx = buildTenantCtx(env, resolved);
    expect(ctx.db).toBe(env.DB);
    expect(ctx.kv).toBe(env.MANICBOT);
  });

  it('different tenants get different prefixes', () => {
    const resolvedA = {
      tenantId: 'a',
      tenant: { id: 'a', name: 'A' },
      bot: { botId: '10', botToken: '10:t', webhookSecret: 'ws' },
      TG: 'https://api.telegram.org/bot10:t',
    };
    const resolvedB = {
      tenantId: 'b',
      tenant: { id: 'b', name: 'B' },
      bot: { botId: '20', botToken: '20:t', webhookSecret: 'ws' },
      TG: 'https://api.telegram.org/bot20:t',
    };

    const ctxA = buildTenantCtx(env, resolvedA);
    const ctxB = buildTenantCtx(env, resolvedB);

    expect(ctxA.prefix).toBe('t:a:');
    expect(ctxB.prefix).toBe('t:b:');
    expect(ctxA.prefix).not.toBe(ctxB.prefix);
  });

  it('tenant context carries the correct tenant document', () => {
    const resolved = {
      tenantId: 'salon_x',
      tenant: { id: 'salon_x', name: 'Salon X', plan: 'pro' },
      bot: { botId: '333', botToken: '333:tok', webhookSecret: 'ws' },
      TG: 'https://api.telegram.org/bot333:tok',
    };
    const ctx = buildTenantCtx(env, resolved);
    expect(ctx.tenant.name).toBe('Salon X');
    expect(ctx.tenant.id).toBe('salon_x');
  });
});

// ── Legacy vs D1 context resolution ───────────────────────────────────────

describe('legacy vs D1 context resolution', () => {
  const baseEnv = {
    MANICBOT: null,
    DB: null,
    BOT_TOKEN: '99999:AAlegacy',
    ADMIN_KEY: 'adm',
    WEBHOOK_SECRET: 'wh',
    ADMIN_CHAT_ID: '12345',
    AI: null,
    WORKERS_AI_API_TOKEN: null,
    CLOUDFLARE_ACCOUNT_ID: null,
  };

  let env;

  beforeEach(() => {
    const db = createMockD1();
    const kv = makeMockKv();
    env = { ...baseEnv, MANICBOT: kv, DB: db };
  });

  it('buildLegacyCtx uses b:{botId}: prefix and null tenantId', () => {
    const ctx = buildLegacyCtx(env);
    expect(ctx.prefix).toBe('b:99999:');
    expect(ctx.tenantId).toBeNull();
  });

  it('buildLegacyCtx has db and kv from env', () => {
    const ctx = buildLegacyCtx(env);
    expect(ctx.db).toBe(env.DB);
    expect(ctx.kv).toBe(env.MANICBOT);
  });

  it('legacy prefix b: is different from tenant prefix t:', () => {
    const legacyCtx = buildLegacyCtx(env);
    const tenantCtx = buildTenantCtx(env, {
      tenantId: 'salon',
      tenant: { id: 'salon', name: 'Salon' },
      bot: { botId: '99999', botToken: '99999:AAlegacy', webhookSecret: 'wh' },
      TG: 'https://api.telegram.org/bot99999:AAlegacy',
    });

    expect(legacyCtx.prefix).toBe('b:99999:');
    expect(tenantCtx.prefix).toBe('t:salon:');
    expect(legacyCtx.prefix).not.toBe(tenantCtx.prefix);
  });

  it('resolveTenantFromBotId returns null for unknown bot', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx = { db, kv, globalKv: kv };
    const result = await resolveTenantFromBotId(ctx, 'unknown_bot_id', null);
    expect(result).toBeNull();
  });

  it('resolveTenantFromBotId resolves when bot exists in D1', async () => {
    const ENC_KEY = 'test-encryption-key-32-bytes-long-1234';
    const db = createMockD1();
    const kv = makeMockKv();
    const ctx = { db, kv, globalKv: kv };

    await putTenant(ctx, 't_new', {
      id: 't_new', name: 'New Salon', active: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    await putBot(ctx, '888', {
      botId: '888', tenantId: 't_new', botToken: '888:secret',
      webhookSecret: 'wh1', active: true,
      createdAt: Date.now(), updatedAt: Date.now(),
    }, ENC_KEY);

    const result = await resolveTenantFromBotId(ctx, '888', ENC_KEY);
    expect(result).not.toBeNull();
    expect(result.tenantId).toBe('t_new');
    expect(result.tenant.name).toBe('New Salon');
    expect(result.bot.botId).toBe('888');
    expect(result.TG).toContain('888:secret');
  });

  it('legacy and D1 contexts write to isolated KV spaces', async () => {
    const legacyCtx = buildLegacyCtx(env);
    const tenantCtx = buildTenantCtx(env, {
      tenantId: 'salon_kv',
      tenant: { id: 'salon_kv', name: 'Salon KV' },
      bot: { botId: '99999', botToken: '99999:tok', webhookSecret: 'wh' },
      TG: 'https://api.telegram.org/bot99999:tok',
    });

    await kvPut(legacyCtx, 'cfg:admin', 'legacy_admin');
    await kvPut(tenantCtx, 'cfg:admin', 'tenant_admin');

    expect(await kvGet(legacyCtx, 'cfg:admin')).toBe('legacy_admin');
    expect(await kvGet(tenantCtx, 'cfg:admin')).toBe('tenant_admin');
  });
});

// ── Cross-tenant appointment isolation ────────────────────────────────────

describe('cross-tenant appointment isolation', () => {
  it('appointments in tenant A are not visible from tenant B via getApts', async () => {
    const db = createMockD1();
    const kv = makeMockKv();
    const ctxA = {
      db, kv, prefix: 't:salon_a:', tenantId: 'salon_a',
      tenant: { salon: { name: 'A', workHours: { from: 9, to: 19 } }, billingStatus: 'trialing', plan: 'pro' },
      svc: [{ id: 'classic', e: 'x', dur: 60, price: 80, active: true, names: { ru: 'M' } }],
      svcIds: new Set(['classic']),
    };
    const ctxB = {
      db, kv, prefix: 't:salon_b:', tenantId: 'salon_b',
      tenant: { salon: { name: 'B', workHours: { from: 9, to: 19 } }, billingStatus: 'trialing', plan: 'pro' },
      svc: [{ id: 'classic', e: 'x', dur: 60, price: 80, active: true, names: { ru: 'M' } }],
      svcIds: new Set(['classic']),
    };

    // Use a future timestamp so `getApts` (ts > Date.now() - 3600000) doesn't filter them out.
    const futureTs = Date.now() + 86400000;
    await saveApt(ctxA, {
      chatId: 10, svcId: 'classic', date: '2026-04-21', time: '10:00',
      ts: futureTs,
      userName: 'ClientA', userPhone: '+48111',
    });

    await saveApt(ctxB, {
      chatId: 20, svcId: 'classic', date: '2026-04-21', time: '11:00',
      ts: futureTs + 3600000,
      userName: 'ClientB', userPhone: '+48222',
    });

    // getApts is scoped by tenantId and chatId
    const aptsA = await getApts(ctxA, 10);
    const aptsB = await getApts(ctxB, 20);

    // Tenant A only sees its own appointment
    expect(aptsA).toHaveLength(1);
    expect(aptsA[0].userName).toBe('ClientA');
    expect(aptsB).toHaveLength(1);
    expect(aptsB[0].userName).toBe('ClientB');

    // Cross-tenant: tenant A cannot see tenant B's client
    const crossApts = await getApts(ctxA, 20);
    expect(crossApts).toHaveLength(0);
  });
});
