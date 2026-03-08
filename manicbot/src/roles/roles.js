/**
 * Role resolution: platform roles (system_admin, support) and tenant roles (tenant_owner, master).
 * Platform keys are global: role:{chatId}, support:agents.
 * Tenant keys use tenant prefix: t:{tenantId}:role:{chatId}.
 */

const PLATFORM_ROLE_PREFIX = 'role:';
const SUPPORT_AGENTS_KEY = 'support:agents';

export const ROLES = {
  SYSTEM_ADMIN: 'system_admin',
  SUPPORT: 'support',
  TENANT_OWNER: 'tenant_owner',
  MASTER: 'master',
  CLIENT: 'client',
};

/**
 * Get platform role (stored globally, no tenant prefix).
 */
export async function getPlatformRole(kv, chatId) {
  if (!kv || chatId == null) return null;
  try {
    const raw = await kv.get(PLATFORM_ROLE_PREFIX + chatId, 'json');
    return raw?.role || null;
  } catch {
    return null;
  }
}

/**
 * Set platform role (system_admin or support). Only system_admin should call this.
 */
export async function setPlatformRole(kv, chatId, role) {
  if (!kv || chatId == null || !role) return false;
  if (role !== ROLES.SYSTEM_ADMIN && role !== ROLES.SUPPORT) return false;
  try {
    await kv.put(PLATFORM_ROLE_PREFIX + chatId, JSON.stringify({ role, createdAt: Date.now() }));
    return true;
  } catch (e) {
    console.error('setPlatformRole:', e.message);
    return false;
  }
}

/**
 * Remove platform role (so user is no longer system_admin or support).
 */
export async function removePlatformRole(kv, chatId) {
  if (!kv || chatId == null) return false;
  try {
    await kv.delete(PLATFORM_ROLE_PREFIX + chatId);
    return true;
  } catch (e) {
    console.error('removePlatformRole:', e.message);
    return false;
  }
}

/**
 * Get tenant role (uses ctx = tenant-scoped KV via ctx.prefix).
 */
export async function getTenantRole(ctx, chatId) {
  const v = await ctx.kv.get(ctx.prefix + 'role:' + chatId, 'json');
  return v?.role || null;
}

/**
 * Set tenant role (tenant_owner or master). Uses tenant-scoped ctx.
 */
export async function setTenantRole(ctx, chatId, role) {
  if (!role || (role !== ROLES.TENANT_OWNER && role !== ROLES.MASTER)) return false;
  try {
    await ctx.kv.put(ctx.prefix + 'role:' + chatId, JSON.stringify({ role, createdAt: Date.now() }));
    return true;
  } catch (e) {
    console.error('setTenantRole:', e.message);
    return false;
  }
}

/**
 * Resolve effective role: platform first, then tenant, then client.
 * ctx must have .kv and .prefix (tenant-scoped). For platform role we need global kv.
 * So we need both: kv (global) and ctx (tenant-scoped). Pass env.MANICBOT for global.
 */
export async function resolveRole(globalKv, ctx, chatId) {
  if (chatId == null) return ROLES.CLIENT;
  const platformRole = await getPlatformRole(globalKv, chatId);
  if (platformRole === ROLES.SYSTEM_ADMIN || platformRole === ROLES.SUPPORT) {
    return platformRole;
  }
  if (ctx?.prefix) {
    const tenantRole = await getTenantRole(ctx, chatId);
    if (tenantRole === ROLES.TENANT_OWNER || tenantRole === ROLES.MASTER) {
      return tenantRole;
    }
  }
  return ROLES.CLIENT;
}

/**
 * Check if user is in support agents list (for ticket broadcast).
 */
export async function getSupportAgents(globalKv) {
  if (!globalKv) return [];
  try {
    const raw = await globalKv.get(SUPPORT_AGENTS_KEY, 'json');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function addSupportAgent(globalKv, chatId) {
  if (!globalKv || chatId == null) return false;
  const list = await getSupportAgents(globalKv);
  if (list.includes(chatId)) return true;
  list.push(chatId);
  try {
    await globalKv.put(SUPPORT_AGENTS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.error('addSupportAgent:', e.message);
    return false;
  }
}

export async function removeSupportAgent(globalKv, chatId) {
  if (!globalKv) return false;
  const list = (await getSupportAgents(globalKv)).filter(id => id !== chatId);
  try {
    await globalKv.put(SUPPORT_AGENTS_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.error('removeSupportAgent:', e.message);
    return false;
  }
}

export function isSystemAdmin(role) { return role === ROLES.SYSTEM_ADMIN; }
export function isSupport(role) { return role === ROLES.SUPPORT; }
export function isTenantOwner(role) { return role === ROLES.TENANT_OWNER; }
export function isMaster(role) { return role === ROLES.MASTER; }
export function isClient(role) { return role === ROLES.CLIENT; }
