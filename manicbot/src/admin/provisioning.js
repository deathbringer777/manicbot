/**
 * Admin provisioning: create tenant, register bot, bind bot, set owner, add master, add support.
 * Uses D1 for tenants/bots and roles. KV only for encrypted bot tokens.
 */

import { putTenant, putBot, getTenant, getBot, getBotToken, getBotIdsByTenantId, defaultTenantPayload, defaultBotPayload } from '../tenant/storage.js';
import { TRIAL_DURATION_MS } from '../billing/config.js';
import { setPlatformRole, setTenantRole, addSupportAgent, removeSupportAgent, getSupportAgents, addTechnicalSupportAgent, removeTechnicalSupportAgent, removePlatformRole, ROLES } from '../roles/roles.js';
import { randomId } from '../utils/security.js';

export async function createTenant(ctx, name, env) {
  if (!ctx?.db || !name?.trim()) return { ok: false, error: 'Missing db or name' };
  const tenantId = 't_' + randomId(6);
  const payload = defaultTenantPayload(null, env || {});
  payload.id = tenantId;
  payload.name = name.trim();
  payload.createdAt = Date.now();
  payload.updatedAt = Date.now();
  payload.billingStatus = 'trialing';
  payload.plan = 'pro';
  payload.trialEndsAt = Date.now() + TRIAL_DURATION_MS;
  payload.graceEndsAt = null;
  await putTenant(ctx, tenantId, payload);
  return { ok: true, tenantId, name: payload.name };
}

export async function registerBot(ctx, botToken, tenantId, webhookSecret, encryptionKey = null) {
  if (!ctx?.db || !botToken?.includes(':')) return { ok: false, error: 'Invalid token' };
  const botId = botToken.split(':')[0];
  if (tenantId) {
    const existing = await getBotIdsByTenantId(ctx, tenantId);
    if (existing.length > 0) return { ok: false, error: 'tenant_has_bot' };
  }
  const payload = defaultBotPayload(botId, tenantId || null, botToken, webhookSecret || '');
  await putBot(ctx, botId, payload, encryptionKey);
  return { ok: true, botId, tenantId: payload.tenantId };
}

export async function bindBotToTenant(ctx, botId, tenantId, encryptionKey = null) {
  if (!ctx?.db || !botId || !tenantId) return { ok: false, error: 'Missing botId or tenantId' };
  const bot = await getBot(ctx, botId);
  if (!bot) return { ok: false, error: 'Bot not found' };
  const tenant = await getTenant(ctx, tenantId);
  if (!tenant) return { ok: false, error: 'Tenant not found' };
  const existingBots = await getBotIdsByTenantId(ctx, tenantId);
  if (existingBots.length > 0 && !existingBots.includes(botId)) {
    return { ok: false, error: 'tenant_has_bot' };
  }
  const token = await getBotToken(ctx, botId, encryptionKey);
  if (!token) return { ok: false, error: 'Bot token not available' };
  const payload = { ...bot, tenantId, botToken: token, updatedAt: Date.now() };
  await putBot(ctx, botId, payload, encryptionKey);
  return { ok: true };
}

export async function setTenantOwner(ctx, chatId) {
  if (!ctx?.tenantId || chatId == null) return { ok: false, error: 'Missing ctx or chatId' };
  return setTenantRole(ctx, chatId, ROLES.TENANT_OWNER);
}

export async function addMasterToTenant(ctx, chatId) {
  if (!ctx?.tenantId || chatId == null) return { ok: false, error: 'Missing ctx or chatId' };
  return setTenantRole(ctx, chatId, ROLES.MASTER);
}

export async function setSystemAdmin(ctx, chatId) {
  return setPlatformRole(ctx, chatId, ROLES.SYSTEM_ADMIN);
}

export async function addSupport(ctx, chatId) {
  if (chatId == null) return false;
  await addSupportAgent(ctx, chatId);
  return setPlatformRole(ctx, chatId, ROLES.SUPPORT);
}

export async function removeSupport(ctx, chatId) {
  if (chatId == null) return false;
  await removeSupportAgent(ctx, chatId);
  await removePlatformRole(ctx, chatId);
  return true;
}

export async function addTechnicalSupport(ctx, chatId) {
  if (chatId == null) return false;
  await addTechnicalSupportAgent(ctx, chatId);
  return setPlatformRole(ctx, chatId, ROLES.TECHNICAL_SUPPORT);
}

export async function removeTechnicalSupport(ctx, chatId) {
  if (chatId == null) return false;
  await removeTechnicalSupportAgent(ctx, chatId);
  await removePlatformRole(ctx, chatId);
  return true;
}

export { getSupportAgents };
