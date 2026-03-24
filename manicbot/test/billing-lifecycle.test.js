/**
 * Тесты для src/billing/lifecycle.js
 * Покрывает: isBillingExpired (чистая функция) и checkBillingExpiry (side-effects).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isBillingExpired, checkBillingExpiry } from '../src/billing/lifecycle.js';
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
});
