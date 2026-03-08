/**
 * Admin provisioning: create tenant, register bot, bind bot, set owner, add master, add support.
 * Only system_admin (platform role) should call these. Uses global KV for tenants/bots and tenant-scoped for roles.
 */

import { putTenant, putBot, getTenant, getBot, getBotToken, defaultTenantPayload, defaultBotPayload } from '../tenant/storage.js';
import { setPlatformRole, setTenantRole, addSupportAgent, removeSupportAgent, getSupportAgents, ROLES } from '../roles/roles.js';
import { randomId } from '../utils/security.js';

export async function createTenant(globalKv, name, env) {
  if (!globalKv || !name?.trim()) return { ok: false, error: 'Missing kv or name' };
  const tenantId = 't_' + randomId(6);
  const payload = defaultTenantPayload(null, env || {});
  payload.id = tenantId;
  payload.name = name.trim();
  payload.createdAt = Date.now();
  payload.updatedAt = Date.now();
  await putTenant(globalKv, tenantId, payload);
  return { ok: true, tenantId, name: payload.name };
}

export async function registerBot(globalKv, botToken, tenantId, webhookSecret, encryptionKey = null) {
  if (!globalKv || !botToken?.includes(':')) return { ok: false, error: 'Invalid token' };
  const botId = botToken.split(':')[0];
  const tenant = tenantId ? await getTenant(globalKv, tenantId) : null;
  const payload = defaultBotPayload(botId, tenantId || null, botToken, webhookSecret || '');
  await putBot(globalKv, botId, payload, encryptionKey);
  return { ok: true, botId, tenantId: payload.tenantId };
}

export async function bindBotToTenant(globalKv, botId, tenantId, encryptionKey = null) {
  if (!globalKv || !botId || !tenantId) return { ok: false, error: 'Missing botId or tenantId' };
  const bot = await getBot(globalKv, botId);
  if (!bot) return { ok: false, error: 'Bot not found' };
  const tenant = await getTenant(globalKv, tenantId);
  if (!tenant) return { ok: false, error: 'Tenant not found' };
  const token = await getBotToken(globalKv, botId, encryptionKey);
  if (!token) return { ok: false, error: 'Bot token not available' };
  const payload = { ...bot, tenantId, botToken: token, updatedAt: Date.now() };
  await putBot(globalKv, botId, payload, encryptionKey);
  return { ok: true };
}

export async function setTenantOwner(ctx, chatId) {
  if (!ctx?.prefix || chatId == null) return { ok: false, error: 'Missing ctx or chatId' };
  return setTenantRole(ctx, chatId, ROLES.TENANT_OWNER);
}

export async function addMasterToTenant(ctx, chatId) {
  if (!ctx?.prefix || chatId == null) return { ok: false, error: 'Missing ctx or chatId' };
  return setTenantRole(ctx, chatId, ROLES.MASTER);
}

export async function setSystemAdmin(globalKv, chatId) {
  return setPlatformRole(globalKv, chatId, ROLES.SYSTEM_ADMIN);
}

export async function addSupport(globalKv, chatId) {
  if (chatId == null) return false;
  await addSupportAgent(globalKv, chatId);
  return setPlatformRole(globalKv, chatId, ROLES.SUPPORT);
}

export async function removeSupport(globalKv, chatId) {
  await removeSupportAgent(globalKv, chatId);
}

export { getSupportAgents };
