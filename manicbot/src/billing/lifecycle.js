/**
 * Billing lifecycle: переходы состояний биллинга для тенанта.
 *
 * Раньше логика trial→inactive и grace_period→inactive дублировалась прямо
 * в src/handlers/cron.js. Вынесена сюда чтобы:
 *  1. Легко тестировать без запуска cron-окружения.
 *  2. При необходимости вызывать из других мест (например, из middleware).
 *
 * Экспорты:
 *  - checkBillingExpiry(ctx, now?)       — основная функция для cron (side-effects)
 *  - isBillingExpired(tenant, now?)      — чистая функция: истёк ли срок
 *  - isComped(tenant)                    — чистая функция: free-grant аккаунт?
 *  - billingLockoutDeadline(tenant, now?) — чистая функция для фазы предупреждений
 */

import { updateTenantBilling } from './storage.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';

/**
 * Pure derivation: is this a "comped" (free manual grant) account?
 *
 * A comped tenant is `active` with NO Stripe subscription and NO trial clock.
 * This matches the prod free-grant MAX accounts exactly: a real paid plan
 * always carries `stripeSubscriptionId`; a trial always carries `trialEndsAt`.
 *
 * We detect comped PURELY by derivation rather than a DB column on purpose:
 * adding a `tenants` column would have to be threaded through
 * getTenant/docToTenantParams/putTenant's INSERT-OR-REPLACE contract, and a
 * missed thread would NULL it on the next billing webhook write.
 *
 * Comped accounts must NEVER be auto-flipped to inactive and must NOT receive
 * hard-lockout warnings — only a soft "grant ending" notice.
 *
 * @param {{ billingStatus?: string, stripeSubscriptionId?: string|null, trialEndsAt?: number|null }} tenant
 * @returns {boolean}
 */
export function isComped(tenant) {
  if (!tenant) return false;
  return (
    tenant.billingStatus === 'active' &&
    !tenant.stripeSubscriptionId &&
    !tenant.trialEndsAt
  );
}

/**
 * Pure helper: does this tenant carry a REAL (Stripe-backed) subscription?
 * Both a non-null `subscriptionStatus` AND a `stripeSubscriptionId` are
 * required so comped accounts (no sub) and bare local rows never qualify.
 * @param {{ subscriptionStatus?: string|null, stripeSubscriptionId?: string|null }} tenant
 * @returns {boolean}
 */
function hasRealSubscription(tenant) {
  return !!(tenant && tenant.subscriptionStatus != null && tenant.stripeSubscriptionId);
}

/**
 * Чистая функция: проверяет, истёк ли срок триала, grace-периода или
 * отменённой (cancel-at-period-end) реальной подписки.
 * Не делает никаких side-effects — удобна для тестирования.
 *
 * Ветка `subscription_period_ended` — belt-and-suspenders на случай
 * пропущенного вебхука `customer.subscription.deleted`: если у тенанта есть
 * РЕАЛЬНАЯ подписка с `cancelAtPeriodEnd` и `now > currentPeriodEnd`, мы сами
 * гасим доступ. Comped-аккаунты исключены (`!isComped`) — у них нет подписки,
 * а `currentPeriodEnd` (если есть) описывает срок гранта, а не платёж.
 *
 * @param {{ billingStatus: string, subscriptionStatus?: string|null, stripeSubscriptionId?: string|null, trialEndsAt?: number|null, graceEndsAt?: number|null, cancelAtPeriodEnd?: boolean, currentPeriodEnd?: number|null }} tenant
 * @param {number} [now] - Unix seconds (по умолчанию nowSec())
 * @returns {'trial_expired' | 'grace_expired' | 'subscription_period_ended' | null}
 */
export function isBillingExpired(tenant, now = nowSec()) {
  if (!tenant) return null;
  if (tenant.billingStatus === 'trialing' && tenant.trialEndsAt && now > tenant.trialEndsAt) {
    return 'trial_expired';
  }
  if (tenant.billingStatus === 'grace_period' && tenant.graceEndsAt && now > tenant.graceEndsAt) {
    return 'grace_expired';
  }
  // Real cancel-at-period-end subscription whose period already lapsed but the
  // deletion webhook never landed. Never applies to comped (guarded below).
  if (
    !isComped(tenant) &&
    hasRealSubscription(tenant) &&
    tenant.cancelAtPeriodEnd &&
    tenant.currentPeriodEnd &&
    now > tenant.currentPeriodEnd
  ) {
    return 'subscription_period_ended';
  }
  return null;
}

/**
 * Pure helper for the warnings phase: when (if ever) is this tenant's access
 * about to change, and is that a hard lockout or a soft grant-end?
 *
 * Precedence:
 *   1. comped + future currentPeriodEnd → soft `grant_ending` (checked FIRST so
 *      a comped row with a stray cancelAtPeriodEnd can never become a lockout).
 *   2. grace_period + future graceEndsAt → hard `lockout`.
 *   3. real cancel-at-period-end sub + future currentPeriodEnd → hard `lockout`.
 *   4. otherwise → no deadline.
 *
 * Only FUTURE deadlines are returned — an already-passed grace/period means the
 * lockout transition itself is due (handled by checkBillingExpiry / canUse),
 * not a warning.
 *
 * @param {object} tenant
 * @param {number} [now] - Unix seconds
 * @returns {{ deadline: number|null, kind: 'lockout' | 'grant_ending' | null }}
 */
export function billingLockoutDeadline(tenant, now = nowSec()) {
  const none = { deadline: null, kind: null };
  if (!tenant) return none;

  // 1) Comped grant ending — soft notice. Takes priority over the sub branch.
  if (isComped(tenant)) {
    if (tenant.currentPeriodEnd && tenant.currentPeriodEnd > now) {
      return { deadline: tenant.currentPeriodEnd, kind: 'grant_ending' };
    }
    return none;
  }

  // 2) Payment-failure grace period running out → hard lockout.
  if (tenant.billingStatus === 'grace_period' && tenant.graceEndsAt && tenant.graceEndsAt > now) {
    return { deadline: tenant.graceEndsAt, kind: 'lockout' };
  }

  // 3) Voluntary cancel-at-period-end on a real subscription → hard lockout.
  if (hasRealSubscription(tenant) && tenant.cancelAtPeriodEnd && tenant.currentPeriodEnd && tenant.currentPeriodEnd > now) {
    return { deadline: tenant.currentPeriodEnd, kind: 'lockout' };
  }

  return none;
}

/**
 * Применяет переход состояния биллинга если срок истёк.
 * Обновляет D1 через updateTenantBilling и мутирует ctx.tenant в памяти.
 *
 * @param {object} ctx  - context с ctx.tenant, ctx.tenantId, ctx.db
 * @param {number} [now] - Unix seconds (по умолчанию nowSec())
 * @returns {Promise<'trial_expired' | 'grace_expired' | 'subscription_period_ended' | null>} тип перехода или null
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
