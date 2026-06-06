/**
 * Tenant billing storage — reads/writes billing fields on tenants table in D1.
 */

import { getTenant, putTenant } from '../tenant/storage.js';
import { nowSec } from '../utils/time.js';
import { dbRun } from '../utils/db.js';

export async function getTenantBilling(ctx, tenantId) {
  const tenant = await getTenant(ctx, tenantId);
  if (!tenant) return null;
  return {
    tenantId,
    plan: tenant.plan || 'start',
    billingStatus: tenant.billingStatus || 'inactive',
    subscriptionStatus: tenant.subscriptionStatus || null,
    trialEndsAt: tenant.trialEndsAt || null,
    graceEndsAt: tenant.graceEndsAt || null,
    currentPeriodEnd: tenant.currentPeriodEnd || null,
    nextPaymentDate: tenant.nextPaymentDate || null,
    stripeCustomerId: tenant.stripeCustomerId || null,
    stripeSubscriptionId: tenant.stripeSubscriptionId || null,
    stripePriceId: tenant.stripePriceId || null,
    billingEmail: tenant.billingEmail || null,
    cancelAtPeriodEnd: tenant.cancelAtPeriodEnd === true,
    updatedAt: tenant.updatedAt || tenant.createdAt,
  };
}

export async function updateTenantBilling(ctx, tenantId, updates) {
  const tenant = await getTenant(ctx, tenantId);
  if (!tenant) return false;
  const updated = {
    ...tenant,
    ...updates,
    updatedAt: nowSec(),
  };
  return putTenant(ctx, tenantId, updated);
}

/**
 * Cascade billing status to SECONDARY salons billed under a parent tenant
 * (multi-salon, MAX plan — migration 0109). Secondaries have
 * `parent_tenant_id` = the parent's id and shadow the parent's entitlement, so
 * when the parent leaves MAX we freeze them ('inactive') and when it returns we
 * restore them ('active'). No-op for tenants with no secondaries. Uses a direct
 * UPDATE (not putTenant) so it touches only billing_status — never the parent's
 * own row, and never the secondary's other columns.
 *
 * @param {object} ctx
 * @param {string} parentTenantId  the billing-root (home) tenant id
 * @param {'active'|'inactive'} billingStatus
 */
export async function setSecondarySalonsBillingStatus(ctx, parentTenantId, billingStatus) {
  if (!ctx?.db || !parentTenantId) return;
  await dbRun(
    ctx,
    'UPDATE tenants SET billing_status = ?, updated_at = ? WHERE parent_tenant_id = ?',
    billingStatus, nowSec(), parentTenantId,
  );
}
