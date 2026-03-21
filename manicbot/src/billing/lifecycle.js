/**
 * Billing lifecycle: переходы состояний биллинга для тенанта.
 *
 * Раньше логика trial→inactive и grace_period→inactive дублировалась прямо
 * в src/handlers/cron.js. Вынесена сюда чтобы:
 *  1. Легко тестировать без запуска cron-окружения.
 *  2. При необходимости вызывать из других мест (например, из middleware).
 *
 * Экспорты:
 *  - checkBillingExpiry(ctx, now?)  — основная функция для cron
 *  - isBillingExpired(tenant, now?) — чистая функция для тестов
 */

import { updateTenantBilling } from './storage.js';

/**
 * Чистая функция: проверяет, истёк ли срок триала или grace-периода.
 * Не делает никаких side-effects — удобна для тестирования.
 *
 * @param {{ billingStatus: string, trialEndsAt?: number|null, graceEndsAt?: number|null }} tenant
 * @param {number} [now] - timestamp (по умолчанию Date.now())
 * @returns {'trial_expired' | 'grace_expired' | null}
 */
export function isBillingExpired(tenant, now = Date.now()) {
  if (!tenant) return null;
  if (tenant.billingStatus === 'trialing' && tenant.trialEndsAt && now > tenant.trialEndsAt) {
    return 'trial_expired';
  }
  if (tenant.billingStatus === 'grace_period' && tenant.graceEndsAt && now > tenant.graceEndsAt) {
    return 'grace_expired';
  }
  return null;
}

/**
 * Применяет переход состояния биллинга если срок истёк.
 * Обновляет D1 через updateTenantBilling и мутирует ctx.tenant в памяти.
 *
 * @param {object} ctx  - context с ctx.tenant, ctx.tenantId, ctx.db
 * @param {number} [now] - timestamp (по умолчанию Date.now())
 * @returns {Promise<'trial_expired' | 'grace_expired' | null>} тип перехода или null
 */
export async function checkBillingExpiry(ctx, now = Date.now()) {
  if (!ctx?.tenant || !ctx?.tenantId || !ctx?.db) return null;

  const expiry = isBillingExpired(ctx.tenant, now);
  if (!expiry) return null;

  try {
    await updateTenantBilling(ctx, ctx.tenantId, {
      billingStatus: 'inactive',
      subscriptionStatus: null,
    });
    // Обновляем in-memory копию чтобы текущий запрос сразу видел новый статус
    ctx.tenant = { ...ctx.tenant, billingStatus: 'inactive', subscriptionStatus: null };
    return expiry;
  } catch (e) {
    console.error('checkBillingExpiry error:', e.message);
    return null;
  }
}
