/**
 * Tests for phaseBillingWarnings — the cron phase that fires a 24h-before
 * warning bell ahead of a hard billing lockout (grace_period or a
 * cancel-at-period-end subscription), and a SOFTER "grant ending" notice for
 * comped (free-grant) accounts.
 *
 * Product contract pinned here:
 *   - Within 24h of a hard-lockout deadline → one `billing.access_limiting_soon`
 *     bell (telegram:true). Idempotent: a second cron tick in the same window
 *     collapses via notifyTenantOwner's (web_user_id, source_slug, source_id,
 *     kind) UNIQUE.
 *   - Deadline more than 24h away (or already passed / absent) → no bell.
 *   - Comped account within 24h of its grant end → `billing.grant_ending`
 *     (soft, no lockout language), NEVER `billing.access_limiting_soon`.
 *
 * Uses the real notifyTenantOwner + mock-db so the dedup is exercised
 * end-to-end (the mock-db's INSERT OR IGNORE mirrors the partial UNIQUE).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

vi.mock('../src/utils/events.js', () => ({ logEvent: vi.fn(async () => {}) }));

const telegramSendMock = vi.fn(async () => ({ ok: true }));
vi.mock('../src/telegram.js', () => ({
  send: (...args) => telegramSendMock(...args),
}));

const { phaseBillingWarnings } = await import('../src/handlers/cron.js');

const DAY = 86400;

async function seedOwner(ctx, webUserId = 'wu_owner') {
  await ctx.db.prepare(
    `INSERT INTO web_users (id, tenant_id, role, email, name) VALUES (?, ?, ?, ?, ?)`,
  ).bind(webUserId, ctx.tenantId, 'tenant_owner', `${webUserId}@x.test`, 'Owner').run();
}

async function readBells(ctx, webUserId = 'wu_owner') {
  const rows = await ctx.db.prepare(
    `SELECT * FROM user_notifications WHERE web_user_id = ?`,
  ).bind(webUserId).all();
  return rows.results;
}

function ctxWithTenant(tenant) {
  const ctx = makeCtx({ tenantId: 't_bill', tenant });
  // makeCtx defaults bot-less; resolveTelegramChat returns null without an
  // owner master/web_users chat_id, so telegram is a silent no-op here — we
  // only assert the in-app bell + its kind, which is what matters.
  return ctx;
}

beforeEach(() => {
  telegramSendMock.mockReset();
  telegramSendMock.mockResolvedValue({ ok: true });
});

describe('phaseBillingWarnings — hard lockout (grace_period)', () => {
  it('fires billing.access_limiting_soon exactly once within 24h, idempotent on repeat', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'grace_period',
      graceEndsAt: nowSec + 12 * 3600, // 12h away → within 24h
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    let bells = await readBells(ctx);
    expect(bells.length).toBe(1);
    expect(bells[0].kind).toBe('billing.access_limiting_soon');
    expect(bells[0].source_slug).toBe('billing');
    // sourceId is bucketed by the deadline's date → stable across re-runs
    const expectedBucket = new Date((nowSec + 12 * 3600) * 1000).toISOString().slice(0, 10);
    expect(bells[0].source_id).toBe(`access_limiting:${expectedBucket}`);

    // Second tick inside the window → no new row (collapses via UNIQUE).
    await phaseBillingWarnings(ctx, now + 60_000);
    bells = await readBells(ctx);
    expect(bells.length).toBe(1);
  });

  it('does NOT fire when the deadline is more than 24h away', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'grace_period',
      graceEndsAt: nowSec + 3 * DAY, // 3 days away
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    expect((await readBells(ctx)).length).toBe(0);
  });

  it('does NOT fire when the deadline has already passed', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'grace_period',
      graceEndsAt: nowSec - 3600, // already expired
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    expect((await readBells(ctx)).length).toBe(0);
  });

  it('fires the lockout warning for a real cancelAtPeriodEnd subscription within 24h', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'active',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_real',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: nowSec + 6 * 3600,
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    const bells = await readBells(ctx);
    expect(bells.length).toBe(1);
    expect(bells[0].kind).toBe('billing.access_limiting_soon');
  });
});

describe('phaseBillingWarnings — comped grant ending (soft)', () => {
  it('fires billing.grant_ending (never a lockout warning) within 24h', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      currentPeriodEnd: nowSec + 10 * 3600, // 10h away
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    const bells = await readBells(ctx);
    expect(bells.length).toBe(1);
    expect(bells[0].kind).toBe('billing.grant_ending');
    // No lockout-kind bell ever emitted for a comped account.
    expect(bells.some(b => b.kind === 'billing.access_limiting_soon')).toBe(false);
    const expectedBucket = new Date((nowSec + 10 * 3600) * 1000).toISOString().slice(0, 10);
    expect(bells[0].source_id).toBe(`grant_ending:${expectedBucket}`);
  });

  it('idempotent: comped grant_ending fires once per deadline-day', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      currentPeriodEnd: nowSec + 10 * 3600,
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    await phaseBillingWarnings(ctx, now + 120_000);
    expect((await readBells(ctx)).length).toBe(1);
  });

  it('does NOT fire for comped with no currentPeriodEnd (open-ended grant)', async () => {
    const now = Date.now();
    const ctx = ctxWithTenant({
      billingStatus: 'active',
      subscriptionStatus: null,
      stripeSubscriptionId: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    expect((await readBells(ctx)).length).toBe(0);
  });
});

describe('phaseBillingWarnings — guards', () => {
  it('no-op without ctx.db / ctx.tenantId', async () => {
    await expect(phaseBillingWarnings({ tenant: { billingStatus: 'grace_period' } }, Date.now()))
      .resolves.toBeUndefined();
  });

  it('no-op for a plain active subscription (no cancel, no grant)', async () => {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);
    const ctx = ctxWithTenant({
      billingStatus: 'active',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_real',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: nowSec + 6 * 3600,
    });
    await seedOwner(ctx);

    await phaseBillingWarnings(ctx, now);
    expect((await readBells(ctx)).length).toBe(0);
  });
});
