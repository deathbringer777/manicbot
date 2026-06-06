/**
 * Тесты для src/billing/lifecycle.js
 * Покрывает: isBillingExpired (чистая функция) и checkBillingExpiry (side-effects).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isBillingExpired,
  checkBillingExpiry,
  isComped,
  billingLockoutDeadline,
} from '../src/billing/lifecycle.js';
import { createMockD1 } from './helpers/mock-db.js';
import { nowSec } from '../src/utils/time.js';

// ─── isBillingExpired — чистая функция ───────────────────────────────────────

describe('isBillingExpired', () => {
  const PAST  = nowSec() - 86400; // вчера (sec)
  const NOW   = nowSec();
  const FUTURE = nowSec() + 86400; // завтра (sec)

  it('возвращает null для null tenant', () => {
    expect(isBillingExpired(null, NOW)).toBeNull();
  });

  it('возвращает null для активного тенанта', () => {
    expect(isBillingExpired({ billingStatus: 'active' }, NOW)).toBeNull();
  });

  it('возвращает null если триал ещё не истёк', () => {
    expect(isBillingExpired({ billingStatus: 'trialing', trialEndsAt: FUTURE }, NOW)).toBeNull();
  });

  it('возвращает trial_expired если trialing и trialEndsAt в прошлом', () => {
    expect(isBillingExpired({ billingStatus: 'trialing', trialEndsAt: PAST }, NOW)).toBe('trial_expired');
  });

  it('возвращает null для trialing без trialEndsAt', () => {
    expect(isBillingExpired({ billingStatus: 'trialing', trialEndsAt: null }, NOW)).toBeNull();
  });

  it('возвращает null если grace_period ещё не истёк', () => {
    expect(isBillingExpired({ billingStatus: 'grace_period', graceEndsAt: FUTURE }, NOW)).toBeNull();
  });

  it('возвращает grace_expired если grace_period и graceEndsAt в прошлом', () => {
    expect(isBillingExpired({ billingStatus: 'grace_period', graceEndsAt: PAST }, NOW)).toBe('grace_expired');
  });

  it('возвращает null для grace_period без graceEndsAt', () => {
    expect(isBillingExpired({ billingStatus: 'grace_period', graceEndsAt: null }, NOW)).toBeNull();
  });

  it('возвращает null для inactive', () => {
    expect(isBillingExpired({ billingStatus: 'inactive' }, NOW)).toBeNull();
  });

  it('граничный случай: now === trialEndsAt — НЕ истёк (строгое >)', () => {
    expect(isBillingExpired({ billingStatus: 'trialing', trialEndsAt: NOW }, NOW)).toBeNull();
  });

  it('граничный случай: now = trialEndsAt + 1 — истёк', () => {
    expect(isBillingExpired({ billingStatus: 'trialing', trialEndsAt: NOW - 1 }, NOW)).toBe('trial_expired');
  });
});

// ─── checkBillingExpiry — с side-effects ─────────────────────────────────────

describe('checkBillingExpiry', () => {
  const PAST   = nowSec() - 86400;
  const FUTURE = nowSec() + 86400;

  function makeTenantCtx(tenant) {
    const db = createMockD1();
    // Создаём запись тенанта в мок-базе
    db._getTable('tenants').push({ id: 'test-tenant', ...tenant });
    return {
      db,
      tenantId: 'test-tenant',
      tenant: { ...tenant },
    };
  }

  it('возвращает null и не меняет ctx если нет tenant', async () => {
    const ctx = { db: createMockD1(), tenantId: 'x', tenant: null };
    const result = await checkBillingExpiry(ctx);
    expect(result).toBeNull();
    expect(ctx.tenant).toBeNull();
  });

  it('возвращает null и не меняет ctx если нет db', async () => {
    const ctx = { db: null, tenantId: 'x', tenant: { billingStatus: 'trialing', trialEndsAt: PAST } };
    const result = await checkBillingExpiry(ctx);
    expect(result).toBeNull();
    expect(ctx.tenant.billingStatus).toBe('trialing');
  });

  it('возвращает null если триал активен', async () => {
    const ctx = makeTenantCtx({ billingStatus: 'trialing', trialEndsAt: FUTURE });
    const result = await checkBillingExpiry(ctx);
    expect(result).toBeNull();
    expect(ctx.tenant.billingStatus).toBe('trialing');
  });

  // Regression for the cron call-site (handlers/cron.js handleCron). It used to
  // pass Date.now() (MILLISECONDS) here, but trialEndsAt/graceEndsAt are stored
  // in SECONDS: ms ≫ any seconds deadline, so every trialing/grace tenant was
  // flipped to inactive on the first tick (zero-length grace). Pin both ways.
  it('cron-unit regression: a future trial is NOT flipped when called with SECONDS', async () => {
    const futureSec = nowSec() + 7 * 86400;
    const ctx = makeTenantCtx({ billingStatus: 'trialing', trialEndsAt: futureSec });
    const result = await checkBillingExpiry(ctx, Math.floor(Date.now() / 1000));
    expect(result).toBeNull();
    expect(ctx.tenant.billingStatus).toBe('trialing');
  });

  it('cron-unit regression: passing MILLISECONDS would wrongly flip a future trial (documents the bug)', async () => {
    const futureSec = nowSec() + 7 * 86400;
    const ctx = makeTenantCtx({ billingStatus: 'trialing', trialEndsAt: futureSec });
    // The old buggy call site passed Date.now() (ms). Show it mis-fires so the
    // seconds fix is never silently reverted to ms.
    const result = await checkBillingExpiry(ctx, Date.now());
    expect(result).toBe('trial_expired');
    expect(ctx.tenant.billingStatus).toBe('inactive');
  });

  it('переводит trialing → inactive когда трайл истёк', async () => {
    const ctx = makeTenantCtx({ billingStatus: 'trialing', trialEndsAt: PAST });
    const result = await checkBillingExpiry(ctx);
    expect(result).toBe('trial_expired');
    expect(ctx.tenant.billingStatus).toBe('inactive');
    expect(ctx.tenant.subscriptionStatus).toBeNull();
  });

  it('переводит grace_period → inactive когда grace истёк', async () => {
    const ctx = makeTenantCtx({ billingStatus: 'grace_period', graceEndsAt: PAST });
    const result = await checkBillingExpiry(ctx);
    expect(result).toBe('grace_expired');
    expect(ctx.tenant.billingStatus).toBe('inactive');
  });

  it('не трогает active тенант', async () => {
    const ctx = makeTenantCtx({ billingStatus: 'active' });
    const result = await checkBillingExpiry(ctx);
    expect(result).toBeNull();
    expect(ctx.tenant.billingStatus).toBe('active');
  });

  it('принимает явный параметр now', async () => {
    const fixedNow = nowSec();
    const ctx = makeTenantCtx({ billingStatus: 'trialing', trialEndsAt: fixedNow - 1 });
    const result = await checkBillingExpiry(ctx, fixedNow);
    expect(result).toBe('trial_expired');
  });

  it('обновляет ctx.tenant in-memory немедленно', async () => {
    const ctx = makeTenantCtx({ billingStatus: 'trialing', trialEndsAt: PAST, plan: 'pro' });
    await checkBillingExpiry(ctx);
    // plan должен сохраниться, только billingStatus измениться
    expect(ctx.tenant.plan).toBe('pro');
    expect(ctx.tenant.billingStatus).toBe('inactive');
  });

  // NEW: belt-and-suspenders flip for a real cancel-at-period-end subscription
  // whose period already ended but the customer.subscription.deleted webhook
  // never landed. Without this, such a tenant keeps full access forever.
  it('переводит реальную cancelAtPeriodEnd-подписку → inactive когда период истёк', async () => {
    const ctx = makeTenantCtx({
      billingStatus: 'active',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_real',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: PAST,
    });
    const result = await checkBillingExpiry(ctx);
    expect(result).toBe('subscription_period_ended');
    expect(ctx.tenant.billingStatus).toBe('inactive');
    expect(ctx.tenant.subscriptionStatus).toBeNull();
  });

  // CRITICAL: a comped (free-grant) MAX account is active, has no subscription
  // and no trial. Even if currentPeriodEnd is in the past, it must NEVER be
  // auto-flipped to inactive — these are the 4 prod free-grant accounts.
  it('НЕ трогает comped-аккаунт даже если currentPeriodEnd в прошлом', async () => {
    const ctx = makeTenantCtx({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: PAST,
    });
    const result = await checkBillingExpiry(ctx);
    expect(result).toBeNull();
    expect(ctx.tenant.billingStatus).toBe('active');
  });
});

// ─── isComped — чистая функция (деривация, без DB-колонки) ────────────────────

describe('isComped', () => {
  it('true для active без подписки и без триала (free grant)', () => {
    expect(isComped({ billingStatus: 'active', stripeSubscriptionId: null, trialEndsAt: null })).toBe(true);
  });

  it('false для null tenant', () => {
    expect(isComped(null)).toBe(false);
  });

  it('false для реальной платной подписки (есть stripeSubscriptionId)', () => {
    expect(isComped({ billingStatus: 'active', stripeSubscriptionId: 'sub_123', trialEndsAt: null })).toBe(false);
  });

  it('false для триала (есть trialEndsAt)', () => {
    expect(isComped({ billingStatus: 'active', stripeSubscriptionId: null, trialEndsAt: nowSec() + 86400 })).toBe(false);
  });

  it('false для trialing статуса', () => {
    expect(isComped({ billingStatus: 'trialing', stripeSubscriptionId: null, trialEndsAt: null })).toBe(false);
  });

  it('false для inactive статуса', () => {
    expect(isComped({ billingStatus: 'inactive', stripeSubscriptionId: null, trialEndsAt: null })).toBe(false);
  });
});

// ─── isBillingExpired — новая ветка subscription_period_ended ─────────────────

describe('isBillingExpired — subscription_period_ended', () => {
  const PAST = nowSec() - 86400;
  const FUTURE = nowSec() + 86400;
  const NOW = nowSec();

  const realCanceledSub = (over = {}) => ({
    billingStatus: 'active',
    subscriptionStatus: 'active',
    stripeSubscriptionId: 'sub_real',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: PAST,
    ...over,
  });

  it('возвращает subscription_period_ended для реальной cancelAtPeriodEnd-подписки за периодом', () => {
    expect(isBillingExpired(realCanceledSub(), NOW)).toBe('subscription_period_ended');
  });

  it('возвращает null если период ещё не истёк', () => {
    expect(isBillingExpired(realCanceledSub({ currentPeriodEnd: FUTURE }), NOW)).toBeNull();
  });

  it('возвращает null если cancelAtPeriodEnd не выставлен', () => {
    expect(isBillingExpired(realCanceledSub({ cancelAtPeriodEnd: false }), NOW)).toBeNull();
  });

  it('возвращает null без stripeSubscriptionId (нет реальной подписки)', () => {
    expect(isBillingExpired(realCanceledSub({ stripeSubscriptionId: null }), NOW)).toBeNull();
  });

  it('возвращает null без subscriptionStatus (нет реальной подписки)', () => {
    expect(isBillingExpired(realCanceledSub({ subscriptionStatus: null }), NOW)).toBeNull();
  });

  it('НЕ возвращает subscription_period_ended для comped (subStatus=null) даже при истёкшем периоде', () => {
    // comped: active, no sub, no trial, period in past — must stay null
    const comped = { billingStatus: 'active', subscriptionStatus: null, stripeSubscriptionId: null, trialEndsAt: null, cancelAtPeriodEnd: true, currentPeriodEnd: PAST };
    expect(isBillingExpired(comped, NOW)).toBeNull();
  });

  it('граничный случай: now === currentPeriodEnd — НЕ истёк (строгое >)', () => {
    expect(isBillingExpired(realCanceledSub({ currentPeriodEnd: NOW }), NOW)).toBeNull();
  });
});

// ─── billingLockoutDeadline — чистая функция для фазы предупреждений ──────────

describe('billingLockoutDeadline', () => {
  const PAST = nowSec() - 86400;
  const FUTURE = nowSec() + 86400;
  const NOW = nowSec();

  it('null tenant → { deadline:null, kind:null }', () => {
    expect(billingLockoutDeadline(null, NOW)).toEqual({ deadline: null, kind: null });
  });

  it('grace_period с graceEndsAt в будущем → lockout на graceEndsAt', () => {
    const r = billingLockoutDeadline({ billingStatus: 'grace_period', graceEndsAt: FUTURE }, NOW);
    expect(r).toEqual({ deadline: FUTURE, kind: 'lockout' });
  });

  it('grace_period с истёкшим graceEndsAt → нет дедлайна (уже пора в lockout, не предупреждать)', () => {
    expect(billingLockoutDeadline({ billingStatus: 'grace_period', graceEndsAt: PAST }, NOW)).toEqual({ deadline: null, kind: null });
  });

  it('реальная cancelAtPeriodEnd-подписка с currentPeriodEnd в будущем → lockout', () => {
    const r = billingLockoutDeadline({
      billingStatus: 'active',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_real',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: FUTURE,
    }, NOW);
    expect(r).toEqual({ deadline: FUTURE, kind: 'lockout' });
  });

  it('comped с currentPeriodEnd в будущем → grant_ending (мягкое уведомление)', () => {
    const r = billingLockoutDeadline({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      currentPeriodEnd: FUTURE,
    }, NOW);
    expect(r).toEqual({ deadline: FUTURE, kind: 'grant_ending' });
  });

  it('comped без currentPeriodEnd (бессрочный грант) → нет дедлайна', () => {
    const r = billingLockoutDeadline({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
    }, NOW);
    expect(r).toEqual({ deadline: null, kind: null });
  });

  it('обычный active с подпиской без cancelAtPeriodEnd → нет дедлайна', () => {
    const r = billingLockoutDeadline({
      billingStatus: 'active',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_real',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: FUTURE,
    }, NOW);
    expect(r).toEqual({ deadline: null, kind: null });
  });

  it('comped имеет приоритет grant_ending над lockout-веткой подписки', () => {
    // Defensive: a comped row that somehow also has cancelAtPeriodEnd set
    // must still be treated as a soft grant, never a hard lockout.
    const r = billingLockoutDeadline({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: FUTURE,
    }, NOW);
    expect(r).toEqual({ deadline: FUTURE, kind: 'grant_ending' });
  });
});
