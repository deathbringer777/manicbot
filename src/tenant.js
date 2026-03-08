// ══════════════════════════════════════════════════════════════
// Multi-tenant: tenant model and KV key prefix
// ══════════════════════════════════════════════════════════════

import { DEFAULT_TENANT_CONFIG, DEFAULT_TENANT_ID } from './constants.js';

const PREFIX = 'tenant:';

/**
 * KV key prefix for a tenant (all keys under this tenant).
 * @param {string} tenantId
 * @returns {string} e.g. "tenant:default:"
 */
export function tenantPrefix(tenantId) {
  return `${PREFIX}${tenantId}:`;
}

/**
 * Tenant config key in KV.
 * @param {string} tenantId
 */
export function tenantConfigKey(tenantId) {
  return `${PREFIX}${tenantId}:config`;
}

/**
 * Tenant metadata (id, name, status, createdAt, updatedAt).
 * @param {string} tenantId
 */
export function tenantMetaKey(tenantId) {
  return `${PREFIX}${tenantId}:meta`;
}

/**
 * Get tenant config from KV. Falls back to DEFAULT_TENANT_CONFIG if not found.
 * @param {KVNamespace} kv
 * @param {string} tenantId
 * @returns {Promise<{ timezone: string, salonName: string, address: string, phone: string, workHours: { from: number, to: number }, services: Array, photos: Object }>}
 */
export async function getTenantConfig(kv, tenantId) {
  if (!kv) return { ...DEFAULT_TENANT_CONFIG };
  try {
    const raw = await kv.get(tenantConfigKey(tenantId), 'json');
    if (raw && typeof raw === 'object') return raw;
  } catch (e) {
    console.error('getTenantConfig fail:', tenantId, e?.message);
  }
  return { ...DEFAULT_TENANT_CONFIG };
}

/**
 * Save tenant config to KV.
 * @param {KVNamespace} kv
 * @param {string} tenantId
 * @param {Object} config
 */
export async function setTenantConfig(kv, tenantId, config) {
  if (!kv) return false;
  try {
    await kv.put(tenantConfigKey(tenantId), JSON.stringify(config));
    return true;
  } catch (e) {
    console.error('setTenantConfig fail:', tenantId, e?.message);
    return false;
  }
}

/**
 * Tenant data model (for platform admin).
 * tenantId, name, status, createdAt, updatedAt.
 * Config is stored separately at tenant:{id}:config.
 */
export function createTenantMeta(overrides = {}) {
  const now = Date.now();
  return {
    tenantId: overrides.tenantId ?? '',
    name: overrides.name ?? '',
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

export { DEFAULT_TENANT_ID };
