import { describe, it, expect, beforeEach } from 'vitest';
import { createTenant } from '../src/admin/provisioning.js';
import { listTenantIds, getTenant } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

function makeCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, tenantId: null, prefix: '' };
}

describe('admin seed prerequisites (D1)', () => {
  let ctx;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('createTenant creates 2 tenants with different names', async () => {
    const r1 = await createTenant(ctx, 'Nails Studio', {});
    const r2 = await createTenant(ctx, 'Luxe Manicure', {});
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const ids = await listTenantIds(ctx);
    expect(ids.length).toBe(2);
    const t1 = await getTenant(ctx, r1.tenantId);
    const t2 = await getTenant(ctx, r2.tenantId);
    expect(t1.name).toBe('Nails Studio');
    expect(t2.name).toBe('Luxe Manicure');
  });

  it('createTenant is idempotent (unique IDs each time)', async () => {
    const r1 = await createTenant(ctx, 'Salon A', {});
    const r2 = await createTenant(ctx, 'Salon A', {});
    expect(r1.tenantId).not.toBe(r2.tenantId);
    const ids = await listTenantIds(ctx);
    expect(ids.length).toBe(2);
  });
});
