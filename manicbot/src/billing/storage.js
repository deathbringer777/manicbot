/**
 * Tenant billing storage — reads/writes billing fields on tenants table in D1.
 */

import { getTenant, putTenant } from '../tenant/storage.js';
import { nowSec } from '../utils/time.js';

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
