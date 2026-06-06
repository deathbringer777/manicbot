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
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

/**
 * Чистая функция: проверяет, истёк ли срок триала или grace-периода.
 * Не делает никаких side-effects — удобна для тестирования.
 *
 * @param {{ billingStatus: string, trialEndsAt?: number|null, graceEndsAt?: number|null }} tenant
 * @param {number} [now] - Unix seconds (по умолчанию nowSec())
 * @returns {'trial_expired' | 'grace_expired' | null}
 */
export function isBillingExpired(tenant, now = nowSec()) {
  if (!tenant) return null;
  // Defensive: callers MUST pass Unix seconds. A value in the milliseconds
  // range (> 1e12 ≈ year 33658 in seconds) is unmistakably Date.now() passed by
  // mistake — normalize rather than silently expiring every tenant. Safety net
  // behind the cron call site, which now converts to seconds explicitly.
  if (now > 1e12) now = Math.floor(now / 1000);
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
 * @param {number} [now] - Unix seconds (по умолчанию nowSec())
 * @returns {Promise<'trial_expired' | 'grace_expired' | null>} тип перехода или null
 */
export async function checkBillingExpiry(ctx, now = nowSec()) {
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
    log.error('billing.lifecycle', e instanceof Error ? e : new Error(String(e.message)));
    return null;
  }
}
