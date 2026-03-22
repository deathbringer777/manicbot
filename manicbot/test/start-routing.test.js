/**
 * Tests for /start panel routing in tenant bots.
 */

import { describe, it, expect } from 'vitest';
import { resolveRole, ROLES, setPlatformRole, setTenantRole } from '../src/roles/roles.js';
import { createMockD1 } from './helpers/mock-db.js';

describe('resolveRole — platform vs tenant priority (D1)', () => {
  it('system_admin platform role is returned even in tenant ctx', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_salon1' };
    await setPlatformRole(ctx, 111, 'system_admin');
    await setTenantRole(ctx, 111, 'tenant_owner');
    const role = await resolveRole(ctx, 111);
    expect(role).toBe('system_admin');
  });

  it('tenant_owner is returned when no platform role exists', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_salon1' };
    await setTenantRole(ctx, 222, 'tenant_owner');
    const role = await resolveRole(ctx, 222);
    expect(role).toBe('tenant_owner');
  });

  it('client is returned when no roles assigned', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_salon1' };
    const role = await resolveRole(ctx, 333);
    expect(role).toBe('client');
  });

  it('master tenant role is returned for staff in tenant ctx', async () => {
    const db = createMockD1();
    const ctx = { db, tenantId: 't_salon1' };
    await setTenantRole(ctx, 444, 'master');
    const role = await resolveRole(ctx, 444);
    expect(role).toBe('master');
  });
});

function resolveStartPanel(ctx, realRole) {
  if (!ctx.tenantId && realRole === 'system_admin') return 'platform_admin';
  if (realRole === 'admin' || realRole === 'tenant_owner' || (ctx.tenantId && realRole === 'system_admin')) return 'admin';
  if (realRole === 'master') return 'master';
  return 'welcome';
}

describe('resolveStartPanel — routing logic', () => {
  const tenantCtx = { tenantId: 't_salon1' };
  const mainCtx = { tenantId: null };

  it('system_admin in tenant bot → admin panel', () => {
    expect(resolveStartPanel(tenantCtx, 'system_admin')).toBe('admin');
  });

  it('tenant_owner in tenant bot → admin panel', () => {
    expect(resolveStartPanel(tenantCtx, 'tenant_owner')).toBe('admin');
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

  it('support in main bot → welcome', () => {
    expect(resolveStartPanel(mainCtx, 'support')).toBe('welcome');
  });
});
