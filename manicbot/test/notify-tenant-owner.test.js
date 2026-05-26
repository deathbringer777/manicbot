/**
 * PR-B (Notification Center 2.0) — Worker `notifyTenantOwner` helper.
 *
 * Mirror of the admin-app captureError sidecar contract: the helper
 * looks up the tenant's `tenant_owner` web_user_id and fans out a
 * single bell row. Used by cron channel-health + Stripe payment webhooks
 * + plugin addon webhooks to alert the salon owner without each call
 * site re-implementing the lookup.
 *
 * Contract pinned here:
 *   1. Happy path: owner row exists → notifyWebUser called, bell row written.
 *   2. No owner row (orphan tenant or platform-scoped call): returns
 *      `{ok: false}` without throwing, no notifyWebUser side effect.
 *   3. Missing ctx fields (no tenantId / no db): silent no-op, never throws.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const telegramSendMock = vi.fn(async () => ({ ok: true }));
vi.mock('../src/telegram.js', () => ({
  send: (...args) => telegramSendMock(...args),
}));

const {
  notifyTenantOwner,
  getTenantOwnerWebUserId,
} = await import('../src/services/userNotify.js');

async function seedOwner(ctx, tenantId, webUserId) {
  await ctx.db.prepare(`
    INSERT INTO web_users (id, tenant_id, role, email, name)
    VALUES (?, ?, ?, ?, ?)
  `).bind(webUserId, tenantId, 'tenant_owner', `${webUserId}@x.test`, 'Owner').run();
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

describe('getTenantOwnerWebUserId', () => {
  it('returns the owner web_user_id when one exists', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedOwner(ctx, 't_a', 'wu_owner');
    const id = await getTenantOwnerWebUserId(ctx);
    expect(id).toBe('wu_owner');
  });

  it('returns null when no owner row exists', async () => {
    const ctx = makeCtx({ tenantId: 't_empty' });
    const id = await getTenantOwnerWebUserId(ctx);
    expect(id).toBeNull();
  });

  it('returns null when tenantId is missing', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    delete ctx.tenantId;
    const id = await getTenantOwnerWebUserId(ctx);
    expect(id).toBeNull();
  });

  it('returns null when db is missing', async () => {
    const id = await getTenantOwnerWebUserId({ tenantId: 't_a' });
    expect(id).toBeNull();
  });

  it('does NOT return masters or non-owner web_users', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    // Seed a master + a tenant_manager — neither should be returned.
    await ctx.db.prepare(`
      INSERT INTO web_users (id, tenant_id, role, email)
      VALUES (?, ?, ?, ?)
    `).bind('wu_master', 't_a', 'master', 'm@x.test').run();
    await ctx.db.prepare(`
      INSERT INTO web_users (id, tenant_id, role, email)
      VALUES (?, ?, ?, ?)
    `).bind('wu_mgr', 't_a', 'tenant_manager', 'mgr@x.test').run();
    const id = await getTenantOwnerWebUserId(ctx);
    expect(id).toBeNull();
  });
});

describe('notifyTenantOwner', () => {
  it('writes a bell row at the resolved tenant owner', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedOwner(ctx, 't_a', 'wu_owner');
    const r = await notifyTenantOwner(ctx, {
      kind: 'channel.broken',
      title: 'Instagram down',
      body: 'Token rejected',
      sourceSlug: 'channel',
      sourceId: 'instagram:token_rejected:2026-05-26',
      inapp: true,
      telegram: false,
    });
    expect(r.ok).toBe(true);
    const rows = await readNotifications(ctx, 'wu_owner');
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe('channel.broken');
    expect(rows[0].source_slug).toBe('channel');
  });

  it('returns ok:false silently when no owner row exists', async () => {
    const ctx = makeCtx({ tenantId: 't_empty' });
    const r = await notifyTenantOwner(ctx, {
      kind: 'billing.payment_failed',
      title: 'Card declined',
    });
    expect(r.ok).toBe(false);
    // No phantom bell rows written.
    const rows = await ctx.db.prepare(
      `SELECT * FROM user_notifications`,
    ).bind().all();
    expect(rows.results.length).toBe(0);
  });

  it('idempotent on (web_user_id, source_slug, source_id, kind)', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    await seedOwner(ctx, 't_a', 'wu_owner');
    const payload = {
      kind: 'channel.broken',
      title: 'Instagram down',
      sourceSlug: 'channel',
      sourceId: 'instagram:token_rejected:2026-05-26',
    };
    await notifyTenantOwner(ctx, payload);
    await notifyTenantOwner(ctx, payload);
    await notifyTenantOwner(ctx, payload);
    const rows = await readNotifications(ctx, 'wu_owner');
    // Second / third writes collapse via the partial UNIQUE.
    expect(rows.length).toBe(1);
  });
});
