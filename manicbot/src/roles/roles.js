/**
 * Role resolution: platform roles (system_admin, support) and tenant roles (tenant_owner, master).
 * All persistent data stored in D1 tables: platform_roles, tenant_roles, support_agents, tenant_support_agents.
 */

import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';

export const ROLES = {
  SYSTEM_ADMIN: 'system_admin',
  TECHNICAL_SUPPORT: 'technical_support',
  SUPPORT: 'support',
  TENANT_OWNER: 'tenant_owner',
  MASTER: 'master',
  CLIENT: 'client',
};

export async function getPlatformRole(ctx, chatId) {
  if (!ctx?.db || chatId == null) return null;
  const row = await dbGet(ctx, 'SELECT role FROM platform_roles WHERE chat_id = ?', chatId);
  return row?.role || null;
}

export async function setPlatformRole(ctx, chatId, role) {
  if (!ctx?.db || chatId == null || !role) return false;
  // system_admin is never stored in D1 — only ADMIN_CHAT_ID (creator) is platform god.
  const allowed = [ROLES.SUPPORT, ROLES.TECHNICAL_SUPPORT];
  if (!allowed.includes(role)) return false;
  try {
    await dbRun(ctx,
      'INSERT OR REPLACE INTO platform_roles (chat_id, role, created_at) VALUES (?, ?, ?)',
      chatId, role, nowSec(),
    );
    return true;
  } catch (e) {
    console.error('setPlatformRole:', e.message);
    return false;
  }
}

export async function removePlatformRole(ctx, chatId) {
  if (!ctx?.db || chatId == null) return false;
  try {
    await dbRun(ctx, 'DELETE FROM platform_roles WHERE chat_id = ?', chatId);
    return true;
  } catch (e) {
    console.error('removePlatformRole:', e.message);
    return false;
  }
}

export async function getTenantRole(ctx, chatId) {
  if (!ctx?.db || !ctx?.tenantId) return null;
  const row = await dbGet(ctx, 'SELECT role FROM tenant_roles WHERE tenant_id = ? AND chat_id = ?', ctx.tenantId, chatId);
  return row?.role || null;
}

export async function setTenantRole(ctx, chatId, role) {
  if (!role || (role !== ROLES.TENANT_OWNER && role !== ROLES.MASTER)) return false;
  if (!ctx?.db || !ctx?.tenantId) return false;
  try {
    await dbRun(ctx,
      'INSERT OR REPLACE INTO tenant_roles (tenant_id, chat_id, role, created_at) VALUES (?, ?, ?, ?)',
      ctx.tenantId, chatId, role, nowSec(),
    );
    return true;
  } catch (e) {
    console.error('setTenantRole:', e.message);
    return false;
  }
}

export async function resolveRole(ctx, chatId) {
  if (chatId == null) return ROLES.CLIENT;
  // SECURITY: web-channel sessions are ALWAYS clients. Defense in depth —
  // even if `getRole` callers go directly to `resolveRole`, the active web
  // session can never escalate via a colliding tenant_roles row.
  if (ctx?._lockToClientRole && ctx._webSessionChatId != null && Number(chatId) === Number(ctx._webSessionChatId)) {
    return ROLES.CLIENT;
  }
  const platformRole = await getPlatformRole(ctx, chatId);
  if (platformRole === ROLES.SYSTEM_ADMIN) {
    const creator = ctx?.adminChatId != null && String(chatId) === String(ctx.adminChatId);
    if (creator) return ROLES.SYSTEM_ADMIN;
    // Stale/illegitimate row — ignore for privileges; fall through to tenant roles.
  } else if (platformRole === ROLES.SUPPORT || platformRole === ROLES.TECHNICAL_SUPPORT) {
    return platformRole;
  }
  if (ctx?.tenantId) {
    const tenantRole = await getTenantRole(ctx, chatId);
    if (tenantRole === ROLES.TENANT_OWNER || tenantRole === ROLES.MASTER) {
      return tenantRole;
    }
  }
  return ROLES.CLIENT;
}

// ── Support agents (platform-level) ─────────────────────────────────────────

export async function getSupportAgents(ctx) {
  if (!ctx?.db) return [];
  const rows = await dbAll(ctx, "SELECT chat_id FROM support_agents WHERE type = 'support'");
  return rows.map(r => r.chat_id);
}

export async function addSupportAgent(ctx, chatId) {
  if (!ctx?.db || chatId == null) return false;
  try {
    await dbRun(ctx,
      "INSERT OR IGNORE INTO support_agents (chat_id, type) VALUES (?, 'support')",
      chatId,
    );
    return true;
  } catch (e) {
    console.error('addSupportAgent:', e.message);
    return false;
  }
}

export async function removeSupportAgent(ctx, chatId) {
  if (!ctx?.db || chatId == null) return false;   // P3.4: добавлен null-check chatId
  try {
    await dbRun(ctx, "DELETE FROM support_agents WHERE chat_id = ? AND type = 'support'", chatId);
    return true;
  } catch (e) {
    console.error('removeSupportAgent:', e.message);
    return false;
  }
}

// ── Technical Support agents (platform-level) ───────────────────────────────

export async function getTechnicalSupportAgents(ctx) {
  if (!ctx?.db) return [];
  const rows = await dbAll(ctx, "SELECT chat_id FROM support_agents WHERE type = 'technical_support'");
  return rows.map(r => r.chat_id);
}

export async function addTechnicalSupportAgent(ctx, chatId) {
  if (!ctx?.db || chatId == null) return false;
  try {
    await dbRun(ctx,
      "INSERT OR IGNORE INTO support_agents (chat_id, type) VALUES (?, 'technical_support')",
      chatId,
    );
    return true;
  } catch (e) {
    console.error('addTechnicalSupportAgent:', e.message);
    return false;
  }
}

export async function removeTechnicalSupportAgent(ctx, chatId) {
  if (!ctx?.db || chatId == null) return false;   // P3.4: добавлен null-check chatId
  try {
    // P3.5: Намеренно удаляются ОБА типа ('technical' и 'support') для данного chatId.
    // Логика: технический поддержант = надмножество обычного, поэтому при его удалении
    // убирается и обычный support-тип. Это предотвращает ситуацию "был tech, стал support"
    // после remove. Если нужно изменить — оставьте только тип 'technical'.
    await dbRun(ctx, "DELETE FROM support_agents WHERE chat_id = ? AND type = 'technical_support'", chatId);
    await dbRun(ctx, "DELETE FROM support_agents WHERE chat_id = ? AND type = 'support'", chatId);
    return true;
  } catch (e) {
    console.error('removeTechnicalSupportAgent:', e.message);
    return false;
  }
}

// ── Tenant-level support agents (per tenant) ────────────────────────────────

export async function getTenantSupportAgents(ctx) {
  if (!ctx?.db || !ctx?.tenantId) return [];
  const rows = await dbAll(ctx,
    'SELECT chat_id FROM tenant_support_agents WHERE tenant_id = ?',
    ctx.tenantId,
  );
  return rows.map(r => r.chat_id);
}

export async function addTenantSupportAgent(ctx, chatId) {
  if (!ctx?.db || !ctx?.tenantId || chatId == null) return false;
  const existing = await getTenantSupportAgents(ctx);
  if (existing.length >= 50) return false;
  if (existing.includes(chatId)) return true;
  try {
    await dbRun(ctx,
      'INSERT OR IGNORE INTO tenant_support_agents (tenant_id, chat_id) VALUES (?, ?)',
      ctx.tenantId, chatId,
    );
    return true;
  } catch (e) {
    console.error('addTenantSupportAgent:', e.message);
    return false;
  }
}

export async function removeTenantSupportAgent(ctx, chatId) {
  if (!ctx?.db || !ctx?.tenantId || chatId == null) return false;
  try {
    await dbRun(ctx,
      'DELETE FROM tenant_support_agents WHERE tenant_id = ? AND chat_id = ?',
      ctx.tenantId, chatId,
    );
    return true;
  } catch (e) {
    console.error('removeTenantSupportAgent:', e.message);
    return false;
  }
}

export function isSystemAdmin(role) { return role === ROLES.SYSTEM_ADMIN; }
export function isTechnicalSupport(role) { return role === ROLES.TECHNICAL_SUPPORT; }
export function isSupport(role) { return role === ROLES.SUPPORT || role === ROLES.TECHNICAL_SUPPORT; }
export function isTenantOwner(role) { return role === ROLES.TENANT_OWNER; }
export function isMaster(role) { return role === ROLES.MASTER; }
export function isClient(role) { return role === ROLES.CLIENT; }
