/**
 * phasePlatformCampaigns — the cron `welcome` backfill path (Phase 2).
 *
 * The `sys_welcome` singleton (kind='welcome', seeded active by migration 0110)
 * delivers the personalized welcome to existing owners whose ManicBot channel is
 * still EMPTY. New owners get it synchronously at registration (admin-app); this
 * cron path only backfills pre-existing/failed empty channels and never
 * late-welcomes an established owner who has already received any platform
 * message. Idempotent via the delivery ledger AND the empty-channel gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const { phasePlatformCampaigns } = await import('../src/services/platformCampaigns.js');

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

function makeWelcomeCtx(tenantId = 't_a') {
  const ctx = makeCtx({ tenantId });
  ctx.bot = { sendMessage() {} };
  ctx.TG = 'https://api.telegram.org/botX';
  ctx.APP_BASE_URL = 'https://manicbot.com';
  return ctx;
}

const run = (ctx, sql, ...b) => ctx.db.prepare(sql).bind(...b).run();
const allRows = async (ctx, table) => (await ctx.db.prepare(`SELECT * FROM ${table}`).bind().all()).results;

function seedTenant(ctx, row) {
  return run(ctx,
    `INSERT INTO tenants (id, name, plan, billing_status, is_test) VALUES (?, ?, ?, ?, ?)`,
    row.id, row.name ?? 'Glow Studio', row.plan ?? 'pro', row.billing_status ?? 'active', row.is_test ?? 0);
}

function seedOwner(ctx, row) {
  return run(ctx,
    `INSERT INTO web_users (id, email, tenant_id, role, lang, email_verified, name) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    row.id, row.email ?? `${row.id}@salon.com`, row.tenant_id, row.role ?? 'tenant_owner',
    row.lang ?? 'ru', row.email_verified ?? 1, row.name ?? 'Anna');
}

function seedWelcome(ctx, { status = 'active', channels = '["center"]' } = {}) {
  return run(ctx,
    `INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, channels_json, schedule_kind, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'sys_welcome', 'welcome', 'Добро пожаловать', 'Привет, {salon_name}!',
    JSON.stringify({ center: 'Здравствуйте, {salon_name}! Рады видеть вас, {owner_name}.' }),
    channels, 'now', status, 1000, 1000);
}

// Pre-seed an existing platform message → channel is NON-empty (last_message_at set).
async function seedExistingChannelMessage(ctx, recipientWebUserId, tenantId) {
  await run(ctx,
    `INSERT INTO platform_threads (id, recipient_web_user_id, recipient_tenant_id, last_message_at, last_message_preview, last_sender_kind, archived, created_at)
     VALUES (?, ?, ?, ?, ?, 'platform', 0, 900)`,
    `pt_existing_${recipientWebUserId}`, recipientWebUserId, tenantId, 950, 'старое объявление');
  await run(ctx,
    `INSERT INTO platform_thread_messages (id, thread_id, sender_kind, sender_web_user_id, body, created_at)
     VALUES (?, ?, 'platform', 'system', ?, 950)`,
    `ptm_existing_${recipientWebUserId}`, `pt_existing_${recipientWebUserId}`, 'старое объявление');
}

describe('phasePlatformCampaigns — welcome backfill', () => {
  it('welcomes an owner with an empty channel, personalized', async () => {
    const ctx = makeWelcomeCtx();
    await seedTenant(ctx, { id: 't_a', name: 'Glow Studio' });
    await seedOwner(ctx, { id: 'wu1', tenant_id: 't_a', name: 'Anna Petrova' });
    await seedWelcome(ctx);

    await phasePlatformCampaigns(ctx, Date.now());

    const msgs = await allRows(ctx, 'platform_thread_messages');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toContain('Glow Studio');
    expect(msgs[0].body).toContain('Anna');
    expect(msgs[0].body).not.toContain('{salon_name}');
    const dels = await allRows(ctx, 'platform_campaign_deliveries');
    expect(dels).toHaveLength(1);
    expect(dels[0]).toMatchObject({ campaign_id: 'sys_welcome', occurrence_key: 'once', channel: 'center', status: 'sent' });
  });

  it('is idempotent across ticks (no double welcome)', async () => {
    const ctx = makeWelcomeCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedOwner(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedWelcome(ctx);

    await phasePlatformCampaigns(ctx, Date.now());
    await phasePlatformCampaigns(ctx, Date.now());

    expect(await allRows(ctx, 'platform_thread_messages')).toHaveLength(1);
    expect(await allRows(ctx, 'platform_campaign_deliveries')).toHaveLength(1);
  });

  it('does NOT late-welcome an owner whose channel already has messages', async () => {
    const ctx = makeWelcomeCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedOwner(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedWelcome(ctx);
    await seedExistingChannelMessage(ctx, 'wu1', 't_a');

    await phasePlatformCampaigns(ctx, Date.now());

    // Only the pre-existing message remains; no welcome delivered.
    const msgs = await allRows(ctx, 'platform_thread_messages');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('старое объявление');
    const dels = (await allRows(ctx, 'platform_campaign_deliveries')).filter((d) => d.campaign_id === 'sys_welcome' && d.channel === 'center');
    expect(dels).toHaveLength(0);
  });

  it('does nothing when the welcome singleton is paused', async () => {
    const ctx = makeWelcomeCtx();
    await seedTenant(ctx, { id: 't_a' });
    await seedOwner(ctx, { id: 'wu1', tenant_id: 't_a' });
    await seedWelcome(ctx, { status: 'paused' });

    await phasePlatformCampaigns(ctx, Date.now());
    expect(await allRows(ctx, 'platform_thread_messages')).toHaveLength(0);
  });
});
