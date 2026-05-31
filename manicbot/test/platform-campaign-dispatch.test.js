/**
 * platformCampaigns.phasePlatformCampaigns — per-tenant dispatch.
 *
 * Covers scan selection, per-tenant audience match + recipient resolution,
 * all four channels, ledger idempotency (no double-send across ticks),
 * zero-audience audit, per-campaign isolation, and subscription-reminder
 * delivery. Uses schedule_kind:'now' announcements where clock-independence is
 * wanted; the subscription test constructs its anchor relative to the real
 * clock so it is due "today" without mocking time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';
import { warsawNow } from '../src/utils/date.js';

const telegramSendMock = vi.fn(async () => ({ ok: true }));
vi.mock('../src/telegram.js', () => ({ send: (...a) => telegramSendMock(...a) }));

const { phasePlatformCampaigns } = await import('../src/services/platformCampaigns.js');

let fetchMock;
beforeEach(() => {
  telegramSendMock.mockClear();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

function makeDispatchCtx(tenantId = 't_a') {
  const ctx = makeCtx({ tenantId });
  ctx.bot = { sendMessage() {} };
  ctx.TG = 'https://api.telegram.org/botX';
  ctx.resendApiKey = 'rk_test';
  ctx.resendFrom = 'ManicBot <noreply@manicbot.com>';
  ctx.APP_BASE_URL = 'https://manicbot.com';
  return ctx;
}

const run = (ctx, sql, ...b) => ctx.db.prepare(sql).bind(...b).run();

function seedTenant(ctx, row) {
  return run(ctx,
    `INSERT INTO tenants (id, name, plan, billing_status, current_period_end, grace_ends_at, cancel_at_period_end, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.name ?? 'Salon', row.plan ?? 'pro', row.billing_status ?? 'active',
    row.current_period_end ?? null, row.grace_ends_at ?? null, row.cancel_at_period_end ?? 0, row.is_test ?? 0);
}

function seedRecipient(ctx, row) {
  return run(ctx,
    `INSERT INTO web_users (id, email, tenant_id, role, lang, email_verified, telegram_chat_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.email ?? `${row.id}@salon.com`, row.tenant_id, row.role ?? 'tenant_owner',
    row.lang ?? 'ru', row.email_verified ?? 1, row.telegram_chat_id ?? null);
}

function seedCampaign(ctx, row) {
  return run(ctx,
    `INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, audience_filter_json, channels_json, schedule_kind, scheduled_at, recurrence_json, status, next_run_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.kind, row.title ?? null, row.body ?? null, row.bodies_json ?? null,
    row.audience_filter_json ?? null, row.channels_json ?? '["center"]', row.schedule_kind ?? 'now',
    row.scheduled_at ?? null, row.recurrence_json ?? null, row.status ?? 'active',
    row.next_run_at ?? null, row.created_by ?? null, row.created_at ?? 1000, row.updated_at ?? 1000);
}

async function allRows(ctx, table) {
  return (await ctx.db.prepare(`SELECT * FROM ${table}`).bind().all()).results;
}

describe('phasePlatformCampaigns — scan + center delivery', () => {
  it('delivers a "now" announcement to the owner via the center channel', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'Hello', body: 'World news', channels_json: '["center"]' });

    await phasePlatformCampaigns(ctx, Date.now());

    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels).toHaveLength(1);
    expect(dels[0]).toMatchObject({ campaign_id: 'c1', recipient_web_user_id: 'wu1', channel: 'center', status: 'sent' });
    const msgs = await allRows(ctx, 'platform_thread_messages');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toContain('World news');
    expect(msgs[0].sender_kind).toBe('platform');
    expect((await allRows(ctx, 'platform_threads'))).toHaveLength(1);
  });

  it('skips paused / draft / done campaigns', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, { id: 'p', kind: 'announcement', status: 'paused', title: 'x', body: 'x' });
    await seedCampaign(ctx, { id: 'd', kind: 'announcement', status: 'draft', title: 'x', body: 'x' });
    await seedCampaign(ctx, { id: 'done', kind: 'announcement', status: 'done', title: 'x', body: 'x' });

    await phasePlatformCampaigns(ctx, Date.now());
    expect(await allRows(ctx, 'platform_campaign_deliveries')).toHaveLength(0);
  });

  it('does nothing without db / tenantId', async () => {
    await expect(phasePlatformCampaigns({}, Date.now())).resolves.toBeUndefined();
    await expect(phasePlatformCampaigns(null, Date.now())).resolves.toBeUndefined();
  });
});

describe('phasePlatformCampaigns — audience + tenant isolation', () => {
  it('by_plan matches only the listed plans', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a', plan: 'pro' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, { id: 'miss', kind: 'announcement', title: 'x', body: 'x', audience_filter_json: JSON.stringify({ scope: 'by_plan', plans: ['start'] }) });
    await seedCampaign(ctx, { id: 'hit', kind: 'announcement', title: 'x', body: 'x', audience_filter_json: JSON.stringify({ scope: 'by_plan', plans: ['pro', 'max'] }) });

    await phasePlatformCampaigns(ctx, Date.now());
    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels.map((d) => d.campaign_id)).toEqual(['hit']);
  });

  it('by_billing_status normalizes grace_period→grace', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a', billing_status: 'grace_period' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, { id: 'g', kind: 'announcement', title: 'x', body: 'x', audience_filter_json: JSON.stringify({ scope: 'by_billing_status', statuses: ['grace'] }) });
    await phasePlatformCampaigns(ctx, Date.now());
    expect(await allRows(ctx, 'platform_campaign_deliveries')).toHaveLength(1);
  });

  it('never delivers to a test tenant', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a', is_test: 1 });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'x', body: 'x' });
    await phasePlatformCampaigns(ctx, Date.now());
    expect(await allRows(ctx, 'platform_campaign_deliveries')).toHaveLength(0);
  });

  it('zero-audience writes one idempotent _none/_audit row (no churn)', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' }); // no recipients seeded
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'x', body: 'x' });
    await phasePlatformCampaigns(ctx, Date.now());
    await phasePlatformCampaigns(ctx, Date.now());
    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels).toHaveLength(1);
    expect(dels[0]).toMatchObject({ recipient_web_user_id: '_none', channel: '_audit', status: 'skipped' });
  });
});

describe('phasePlatformCampaigns — multi-channel + idempotency', () => {
  it('delivers across center+bell+telegram+email in one combined send', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a', telegram_chat_id: 555, email_verified: 1 });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'Combined', body: 'Body', channels_json: '["center","bell","telegram","email"]' });

    await phasePlatformCampaigns(ctx, Date.now());

    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels).toHaveLength(4);
    expect(dels.every((d) => d.status === 'sent')).toBe(true);
    expect(new Set(dels.map((d) => d.channel))).toEqual(new Set(['center', 'bell', 'telegram', 'email']));
    expect(await allRows(ctx, 'platform_thread_messages')).toHaveLength(1);
    expect((await allRows(ctx, 'user_notifications')).length).toBeGreaterThanOrEqual(1);
    expect(telegramSendMock).toHaveBeenCalledWith(ctx, 555, expect.stringContaining('Body'));
    expect(fetchMock).toHaveBeenCalledTimes(1); // one email POST
  });

  it('is idempotent across two cron ticks — exactly one delivery per channel', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a', telegram_chat_id: 555 });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'X', body: 'Y', channels_json: '["center","bell","telegram","email"]' });

    await phasePlatformCampaigns(ctx, Date.now());
    await phasePlatformCampaigns(ctx, Date.now());

    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels).toHaveLength(4);
    expect(await allRows(ctx, 'platform_thread_messages')).toHaveLength(1); // not 2
    expect(telegramSendMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('telegram marked skipped on a botless ctx; other channels still sent', async () => {
    const ctx = makeDispatchCtx();
    ctx.bot = null; ctx.TG = null; // botless tenant
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a', telegram_chat_id: 555 });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'X', body: 'Y', channels_json: '["center","telegram"]' });
    await phasePlatformCampaigns(ctx, Date.now());
    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    const byCh = Object.fromEntries(dels.map((d) => [d.channel, d.status]));
    expect(byCh.center).toBe('sent');
    expect(byCh.telegram).toBe('skipped');
  });

  it('email marked skipped when recipient has no verified email', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a', email_verified: 0 });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'X', body: 'Y', channels_json: '["email"]' });
    await phasePlatformCampaigns(ctx, Date.now());
    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels[0]).toMatchObject({ channel: 'email', status: 'skipped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('processes multiple campaigns independently', async () => {
    const ctx = makeDispatchCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, { id: 'c1', kind: 'announcement', title: 'A', body: 'A', channels_json: '["center"]' });
    await seedCampaign(ctx, { id: 'c2', kind: 'announcement', title: 'B', body: 'B', channels_json: '["center"]' });
    await phasePlatformCampaigns(ctx, Date.now());
    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(new Set(dels.map((d) => d.campaign_id))).toEqual(new Set(['c1', 'c2']));
  });
});

describe('phasePlatformCampaigns — subscription reminder (clock-relative)', () => {
  it('delivers a reminder N days before the renewal anchor', async () => {
    const ctx = makeDispatchCtx();
    const w = warsawNow();
    // Anchor = today + 3 days, noon UTC (stays the same Warsaw calendar day).
    const anchor = Math.floor((Date.UTC(w.year, w.month - 1, w.day) + 3 * 86400000 + 12 * 3600000) / 1000);
    await seedTenant(ctx, { id: 't_a', billing_status: 'active', current_period_end: anchor });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a', lang: 'ru' });
    // hour:0 so atOrAfter is always satisfied regardless of run time.
    await seedCampaign(ctx, {
      id: 'sys_subscription_reminder', kind: 'subscription_reminder', channels_json: '["center"]',
      schedule_kind: 'recurring', recurrence_json: JSON.stringify({ freq: 'daily', hour: 0, minute: 0, daysBefore: 3 }),
    });

    await phasePlatformCampaigns(ctx, Date.now());

    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels).toHaveLength(1);
    expect(dels[0]).toMatchObject({ channel: 'center', status: 'sent', occurrence_key: String(anchor) });
    const msgs = await allRows(ctx, 'platform_thread_messages');
    expect(msgs[0].body).toMatch(/подписка/i);
  });

  it('does not remind a trialing tenant (Stripe owns trial-end)', async () => {
    const ctx = makeDispatchCtx();
    const w = warsawNow();
    const anchor = Math.floor((Date.UTC(w.year, w.month - 1, w.day) + 3 * 86400000 + 12 * 3600000) / 1000);
    await seedTenant(ctx, { id: 't_a', billing_status: 'trialing', current_period_end: anchor });
    await seedRecipient(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedCampaign(ctx, {
      id: 'sys_subscription_reminder', kind: 'subscription_reminder', channels_json: '["center"]',
      schedule_kind: 'recurring', recurrence_json: JSON.stringify({ freq: 'daily', hour: 0, minute: 0, daysBefore: 3 }),
    });
    await phasePlatformCampaigns(ctx, Date.now());
    expect(await allRows(ctx, 'platform_campaign_deliveries')).toHaveLength(0);
  });
});
