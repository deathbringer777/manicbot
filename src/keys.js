// ══════════════════════════════════════════════════════════════
// Tenant-scoped KV key builders
// All keys: tenant:{tenantId}:...
// ══════════════════════════════════════════════════════════════

function pre(tenantId) {
  return `tenant:${tenantId}:`;
}

export function userKey(tenantId, chatId) {
  return `${pre(tenantId)}user:${chatId}`;
}

export function userAptsKey(tenantId, chatId) {
  return `${pre(tenantId)}ua:${chatId}`;
}

export function stateKey(tenantId, chatId) {
  return `${pre(tenantId)}st:${chatId}`;
}

export function langKey(tenantId, chatId) {
  return `${pre(tenantId)}lang:${chatId}`;
}

export function aptKey(tenantId, aptId) {
  return `${pre(tenantId)}apt:${aptId}`;
}

export function dayKey(tenantId, dateStr) {
  return `${pre(tenantId)}day:${dateStr}`;
}

export function monthKey(tenantId, yyyyMm) {
  return `${pre(tenantId)}month:${yyyyMm}`;
}

/** e.g. "2026-03-15" → "2026-03" */
export function monthFromDate(dateStr) {
  return dateStr.slice(0, 7);
}

export function lockKey(tenantId, chatId, date, time) {
  return `${pre(tenantId)}lock:${chatId}:${date}:${time}`;
}

// ─── Members (roles) ─────────────────────────────────────────
export function memberKey(tenantId, chatId) {
  return `${pre(tenantId)}members:${chatId}`;
}

// ─── Billing (Phase 10) ──────────────────────────────────────
export function billingKey(tenantId) {
  return `${pre(tenantId)}billing`;
}

// ─── Bot registry (global, not tenant-scoped) ─────────────────
export const BOT_PREFIX = 'bot:';
export const BINDING_PREFIX = 'binding:';

export function botKey(botId) {
  return `${BOT_PREFIX}${botId}`;
}

export function bindingByBotKey(botId) {
  return `${BINDING_PREFIX}bot:${botId}`;
}

export function bindingByTenantPrefix(tenantId) {
  return `${BINDING_PREFIX}tenant:${tenantId}:`;
}
