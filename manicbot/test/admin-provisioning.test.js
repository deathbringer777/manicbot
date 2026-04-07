import { describe, it, expect, beforeEach } from 'vitest';
import { createTenant, registerBot, setTenantOwner, addMasterToTenant, setSystemAdmin } from '../src/admin/provisioning.js';
import { getTenant, putTenant, getBotIdsByTenantId, getTenantIdByBotId } from '../src/tenant/storage.js';
import { getTenantRole, getPlatformRole, ROLES } from '../src/roles/roles.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx(tenantId = null) {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, tenantId, prefix: tenantId ? `t:${tenantId}:` : '' };
}

describe('admin provisioning (D1)', () => {
  let ctx;
  const ENC_KEY = 'test-encryption-key-32-bytes-long-1234';

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('createTenant → tenant appears in D1', async () => {
    const result = await createTenant(ctx, 'Test Salon', {});
    expect(result.ok).toBe(true);
    expect(result.tenantId).toBeTruthy();
    const tenant = await getTenant(ctx, result.tenantId);
    expect(tenant).not.toBeNull();
    expect(tenant.name).toBe('Test Salon');
    expect(tenant.billingStatus).toBe('trialing');
    expect(tenant.plan).toBe('pro');
  });

  it('registerBot → bot in D1 + token (encrypted) in KV', async () => {
    const result = await registerBot(ctx, '123:abc_token', null, 'wh_secret', ENC_KEY);
    expect(result.ok).toBe(true);
    expect(result.botId).toBe('123');
    const tid = await getTenantIdByBotId(ctx, '123');
    expect(tid).toBeNull();
    const storedToken = await ctx.kv.get('bottoken:123', 'text');
    // Token must be stored encrypted, not as plaintext
    expect(storedToken).not.toBe('123:abc_token');
    expect(storedToken).toBeTruthy();
  });

  it('registerBot with tenantId → bot bound to tenant', async () => {
    await putTenant(ctx, 't1', { id: 't1', name: 'S1', createdAt: Date.now(), updatedAt: Date.now() });
    const result = await registerBot(ctx, '456:xyz', 't1', 'wh', ENC_KEY);
    expect(result.ok).toBe(true);
    expect(await getTenantIdByBotId(ctx, '456')).toBe('t1');
  });

  it('registerBot rejects if tenant already has a bot', async () => {
    await putTenant(ctx, 't2', { id: 't2', name: 'S2', createdAt: Date.now(), updatedAt: Date.now() });
    await registerBot(ctx, '100:a', 't2', 'wh1', ENC_KEY);
    const result = await registerBot(ctx, '200:b', 't2', 'wh2', ENC_KEY);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('tenant_has_bot');
  });

  it('setTenantOwner → tenant_roles record', async () => {
    const tCtx = { ...ctx, tenantId: 't1', prefix: 't:t1:' };
    const result = await setTenantOwner(tCtx, 111);
    expect(result).toBe(true);
    const role = await getTenantRole(tCtx, 111);
    expect(role).toBe(ROLES.TENANT_OWNER);
  });

  it('addMasterToTenant → tenant_roles record with master role', async () => {
    const tCtx = { ...ctx, tenantId: 't1', prefix: 't:t1:' };
    const result = await addMasterToTenant(tCtx, 222);
    expect(result).toBe(true);
    const role = await getTenantRole(tCtx, 222);
    expect(role).toBe(ROLES.MASTER);
  });

  it('setSystemAdmin does not write platform_roles; true only when chatId matches adminChatId', async () => {
    const cctx = { ...ctx, adminChatId: '333' };
    expect(await setSystemAdmin(cctx, 333)).toBe(true);
    expect(await getPlatformRole(cctx, 333)).toBeNull();
    expect(await setSystemAdmin({ ...ctx, adminChatId: '1' }, 333)).toBe(false);
  });
});
