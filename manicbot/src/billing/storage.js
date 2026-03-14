/**
 * Tenant billing storage. Billing state lives on tenant document (tenant:{tenantId}).
 */

import { getTenant, putTenant } from '../tenant/storage.js';

/**
 * Get billing snapshot from tenant document.
 * @param {KVNamespace} kv - global KV
 * @param {string} tenantId
 */
export async function getTenantBilling(kv, tenantId) {
  const tenant = await getTenant(kv, tenantId);
  if (!tenant) return null;
  return {
    tenantId,
    plan: tenant.plan || 'free',
    billingStatus: tenant.billingStatus || 'inactive',
    subscriptionStatus: tenant.subscriptionStatus || null,
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

/**
 * Update tenant billing fields (merge into tenant doc).
 * @param {KVNamespace} kv
 * @param {string} tenantId
 * @param {object} updates - partial billing fields
 */
export async function updateTenantBilling(kv, tenantId, updates) {
  const tenant = await getTenant(kv, tenantId);
  if (!tenant) return false;
  const updated = {
    ...tenant,
    ...updates,
    updatedAt: Date.now(),
  };
  return putTenant(kv, tenantId, updated);
}
