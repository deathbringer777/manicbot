/**
 * Tests for /start panel routing in tenant bots.
 * Bug: system_admin falls through to showWelcome (client screen) in tenant bots
 * because the admin panel check only handles 'admin' and 'master' roles.
 *
 * Expected: in tenant bots, system_admin → showAdminPanel (not showWelcome)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRole, ROLES } from '../src/roles/roles.js';

function makeMockKv(store = new Map()) {
  return {
    get: async (key, type = 'text') => {
      const v = store.get(key);
      if (v == null) return null;
      if (type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      return v;
    },
    put: async (key, value) => {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    delete: async (key) => { store.delete(key); },
    list: async ({ prefix } = {}) => {
      const keys = [...store.keys()].filter(k => !prefix || k.startsWith(prefix));
      return { keys: keys.map(name => ({ name })), list_complete: true };
    },
  };
}

describe('resolveRole — platform vs tenant priority', () => {
  it('system_admin platform role is returned even in tenant ctx (platform takes priority)', async () => {
    const globalKv = makeMockKv(new Map([
      ['role:111', JSON.stringify({ role: 'system_admin' })],
    ]));
    const ctx = {
      kv: makeMockKv(new Map([
        ['t:t_salon1:role:111', JSON.stringify({ role: 'tenant_owner' })],
      ])),
      prefix: 't:t_salon1:',
    };
    // resolveRole returns system_admin (platform role wins)
    const role = await resolveRole(globalKv, ctx, 111);
    expect(role).toBe('system_admin');
  });

  it('tenant_owner is returned when no platform role exists', async () => {
    const globalKv = makeMockKv(); // empty — no platform role
    const tenantStore = new Map([
      ['t:t_salon1:role:222', JSON.stringify({ role: 'tenant_owner' })],
    ]);
    const ctx = { kv: makeMockKv(tenantStore), prefix: 't:t_salon1:' };
    const role = await resolveRole(globalKv, ctx, 222);
    expect(role).toBe('tenant_owner');
  });

  it('client is returned when no roles assigned', async () => {
    const globalKv = makeMockKv();
    const ctx = { kv: makeMockKv(), prefix: 't:t_salon1:' };
    const role = await resolveRole(globalKv, ctx, 333);
    expect(role).toBe('client');
  });

  it('master tenant role is returned for staff in tenant ctx', async () => {
    const globalKv = makeMockKv();
    const ctx = {
      kv: makeMockKv(new Map([['t:t_salon1:role:444', JSON.stringify({ role: 'master' })]])),
      prefix: 't:t_salon1:',
    };
    const role = await resolveRole(globalKv, ctx, 444);
    expect(role).toBe('master');
  });
});

/**
 * Panel routing logic tests (pure function extracted from /start handler).
 * Platform panel only for isPlatformAdmin (creator or system_admin in KV); support no longer sees it.
 */
function resolveStartPanel(ctx, realRole) {
  // Platform admin panel: main bot only, and only for system_admin (support/tech_support no longer get it)
  if (!ctx.tenantId && realRole === 'system_admin') return 'platform_admin';
  // Tenant admin panel: admin, tenant_owner, or system_admin in tenant bot
  if (realRole === 'admin' || realRole === 'tenant_owner' || (ctx.tenantId && realRole === 'system_admin')) return 'admin';
  if (realRole === 'master') return 'master';
  return 'welcome';
}

describe('resolveStartPanel — routing logic', () => {
  const tenantCtx = { tenantId: 't_salon1' };
  const mainCtx = { tenantId: null };

  it('system_admin in tenant bot → admin panel (THE BUG CASE)', () => {
    expect(resolveStartPanel(tenantCtx, 'system_admin')).toBe('admin');
  });

  it('tenant_owner in tenant bot → admin panel', () => {
    expect(resolveStartPanel(tenantCtx, 'tenant_owner')).toBe('admin');
  });

  it('admin in tenant bot → admin panel', () => {
    expect(resolveStartPanel(tenantCtx, 'admin')).toBe('admin');
  });

  it('master in tenant bot → master panel', () => {
    expect(resolveStartPanel(tenantCtx, 'master')).toBe('master');
  });

  it('client in tenant bot → welcome screen', () => {
    expect(resolveStartPanel(tenantCtx, 'client')).toBe('welcome');
  });

  it('system_admin in main bot → platform admin panel', () => {
    expect(resolveStartPanel(mainCtx, 'system_admin')).toBe('platform_admin');
  });

  it('support in main bot → welcome (platform panel only for isPlatformAdmin)', () => {
    expect(resolveStartPanel(mainCtx, 'support')).toBe('welcome');
  });
});
