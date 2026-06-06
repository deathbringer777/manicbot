/**
 * Multi-salon billing cascade (migration 0116).
 *
 * Secondary salons (`parent_tenant_id` set) are billed under their parent's MAX
 * subscription. `setSecondarySalonsBillingStatus` mirrors the parent's
 * entitlement onto them: freeze when the parent leaves MAX, restore when it
 * returns. It must touch ONLY the given parent's secondaries — never the parent
 * itself, never an unrelated tenant, never another parent's children.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { putTenant, getTenant } from '../src/tenant/storage.js';
import { setSecondarySalonsBillingStatus } from '../src/billing/storage.js';
import { phaseBillingReconcileSecondaries } from '../src/handlers/cron.js';
import { createMockD1 } from './helpers/mock-db.js';
import { nowSec } from '../src/utils/time.js';

function makeCtx() {
  return { db: createMockD1() };
}

async function seed(ctx, id, extra = {}) {
  await putTenant(ctx, id, {
    id,
    name: id,
    active: 1,
    plan: 'max',
    billingStatus: 'active',
    createdAt: nowSec(),
    updatedAt: nowSec(),
    ...extra,
  });
}

describe('setSecondarySalonsBillingStatus — multi-salon cascade (0116)', () => {
  let ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await seed(ctx, 'home'); // parent (billing root), no parent_tenant_id
    await seed(ctx, 'sec1', { parentTenantId: 'home' });
    await seed(ctx, 'sec2', { parentTenantId: 'home' });
    await seed(ctx, 'other'); // unrelated independent tenant
    await seed(ctx, 'sec_other', { parentTenantId: 'other' }); // child of a different parent
  });

  it("freezes only the parent's secondaries, leaving parent + others untouched", async () => {
    await setSecondarySalonsBillingStatus(ctx, 'home', 'inactive');
    expect((await getTenant(ctx, 'sec1')).billingStatus).toBe('inactive');
    expect((await getTenant(ctx, 'sec2')).billingStatus).toBe('inactive');
    expect((await getTenant(ctx, 'home')).billingStatus).toBe('active');
    expect((await getTenant(ctx, 'other')).billingStatus).toBe('active');
    expect((await getTenant(ctx, 'sec_other')).billingStatus).toBe('active');
  });

  it('restores secondaries to active when the parent returns to MAX', async () => {
    await setSecondarySalonsBillingStatus(ctx, 'home', 'inactive');
    await setSecondarySalonsBillingStatus(ctx, 'home', 'active');
    expect((await getTenant(ctx, 'sec1')).billingStatus).toBe('active');
    expect((await getTenant(ctx, 'sec2')).billingStatus).toBe('active');
  });

  it('preserves parent_tenant_id across the cascade write', async () => {
    await setSecondarySalonsBillingStatus(ctx, 'home', 'inactive');
    expect((await getTenant(ctx, 'sec1')).parentTenantId).toBe('home');
  });

  it('is a no-op when the parent has no secondaries', async () => {
    await setSecondarySalonsBillingStatus(ctx, 'no_such_parent', 'inactive');
    expect((await getTenant(ctx, 'sec1')).billingStatus).toBe('active');
  });
});

describe('phaseBillingReconcileSecondaries — cascade backstop (0116)', () => {
  it('re-derives each secondary billing status from its parent and repairs drift', async () => {
    const ctx = makeCtx();
    await seed(ctx, 'home', { plan: 'max', billingStatus: 'active' });
    await seed(ctx, 'sec_drifted', { parentTenantId: 'home', plan: 'max', billingStatus: 'inactive' }); // -> active
    await seed(ctx, 'sec_ok', { parentTenantId: 'home', plan: 'max', billingStatus: 'active' }); // stays active
    await seed(ctx, 'pro_home', { plan: 'pro', billingStatus: 'active' }); // not MAX
    await seed(ctx, 'sec_overactive', { parentTenantId: 'pro_home', plan: 'max', billingStatus: 'active' }); // -> inactive

    await phaseBillingReconcileSecondaries(ctx, Date.now());

    expect((await getTenant(ctx, 'sec_drifted')).billingStatus).toBe('active');
    expect((await getTenant(ctx, 'sec_ok')).billingStatus).toBe('active');
    expect((await getTenant(ctx, 'sec_overactive')).billingStatus).toBe('inactive');
    // Parents are never touched by the backstop.
    expect((await getTenant(ctx, 'home')).billingStatus).toBe('active');
    expect((await getTenant(ctx, 'pro_home')).billingStatus).toBe('active');
  });

  it('is a no-op when there are no secondary salons', async () => {
    const ctx = makeCtx();
    await seed(ctx, 'solo', { plan: 'max', billingStatus: 'active' });
    await phaseBillingReconcileSecondaries(ctx, Date.now());
    expect((await getTenant(ctx, 'solo')).billingStatus).toBe('active');
  });
});
