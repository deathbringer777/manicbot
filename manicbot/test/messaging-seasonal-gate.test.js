/**
 * Seasonal (occasion-linked) campaign gate: a platform_campaign with an
 * occasion_key is part of the new messaging service and must be gated by
 * MESSAGING_SEND_ENABLED. Flag off → ledger 'skipped_flag', zero egress. Flag on
 * → real center delivery. Non-occasion campaigns (welcome/announcement) are NOT
 * gated (covered by the existing dispatch tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

vi.mock('../src/telegram.js', () => ({ send: async () => ({ ok: true }) }));
const { phasePlatformCampaigns } = await import('../src/services/platformCampaigns.js');

const run = (ctx, sql, ...b) => ctx.db.prepare(sql).bind(...b).run();
const all = async (ctx, sql, ...b) => (await ctx.db.prepare(sql).bind(...b).all()).results;

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }))); });
afterEach(() => { vi.unstubAllGlobals(); });

function seed(ctx, { sendEnabled }) {
  ctx.messagingSendEnabled = sendEnabled;
  run(ctx, 'INSERT INTO tenants (id, name, plan, billing_status, is_test) VALUES (?, ?, ?, ?, ?)',
    't_a', 'Kurze Łapki', 'pro', 'active', 0);
  run(ctx, `INSERT INTO web_users (id, email, tenant_id, role, lang, email_verified) VALUES (?, ?, ?, 'tenant_owner', ?, 1)`,
    'wu1', 'o@s.com', 't_a', 'pl');
  // occasion-linked seasonal campaign, active, schedule 'now' → due this tick.
  run(ctx,
    `INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, channels_json, schedule_kind, status, occasion_key, created_by, created_at, updated_at)
     VALUES (?, 'announcement', 'Dzień Kobiet', 'x', ?, ?, 'now', 'active', 'womens_day', 'op', 1, 1)`,
    'pc_seasonal', JSON.stringify({ center: 'Wszystkiego najlepszego, {salon_name}!' }), JSON.stringify(['center']));
}

describe('seasonal campaign gate', () => {
  it('stages (skipped_flag, no message) when MESSAGING_SEND_ENABLED is off', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    seed(ctx, { sendEnabled: false });
    await phasePlatformCampaigns(ctx, Date.now());
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.length).toBe(1);
    expect(ledger[0].status).toBe('skipped_flag');
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(0);
  });

  it('delivers to the center channel when the flag is on', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    seed(ctx, { sendEnabled: true });
    await phasePlatformCampaigns(ctx, Date.now());
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger[0].status).toBe('sent');
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toContain('Kurze Łapki');
  });

  it('stages (skipped_flag) when the operator pause flag is set, even with the env flag on', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    seed(ctx, { sendEnabled: true });
    run(ctx, "INSERT INTO platform_settings (key, value, updated_at) VALUES ('messaging_send_paused', '1', 1)");
    await phasePlatformCampaigns(ctx, Date.now());
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger[0].status).toBe('skipped_flag');
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(0);
  });

  it('delivers IN-APP to an opted-in showcase (is_test) tenant even with the flag off, skipping external', async () => {
    const ctx = makeCtx({ tenantId: 't_demo' });
    ctx.messagingSendEnabled = false;
    run(ctx, "INSERT INTO platform_settings (key, value, updated_at) VALUES ('announce_optin_tenants', '[\"t_demo\"]', 1)");
    run(ctx, 'INSERT INTO tenants (id, name, plan, billing_status, is_test) VALUES (?, ?, ?, ?, ?)',
      't_demo', 'Demo Studio', 'max', 'active', 1); // is_test = 1 (showcase)
    run(ctx, `INSERT INTO web_users (id, email, tenant_id, role, lang, email_verified) VALUES (?, ?, ?, 'tenant_owner', ?, 1)`,
      'wu1', 'o@demo.com', 't_demo', 'ru');
    run(ctx,
      `INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, channels_json, schedule_kind, status, occasion_key, created_by, created_at, updated_at)
       VALUES (?, 'announcement', 'Lato', 'x', ?, ?, 'now', 'active', 'summer_start', 'op', 1, 1)`,
      'pc_demo', JSON.stringify({ center: 'Lato w {salon_name}!' }), JSON.stringify(['center', 'email']));

    await phasePlatformCampaigns(ctx, Date.now());

    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(1); // in-app center delivered despite the flag being off
    expect(msgs[0].body).toContain('Demo Studio');
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.find((d) => d.channel === 'center').status).toBe('sent');
    expect(ledger.filter((d) => d.channel === 'email').length).toBe(0); // external skipped entirely
  });

  it('resolves a per-locale template body when the campaign has an empty body + template_key', async () => {
    const ctx = makeCtx({ tenantId: 't_a' });
    ctx.messagingSendEnabled = true;
    run(ctx, 'INSERT INTO tenants (id, name, plan, billing_status, is_test) VALUES (?, ?, ?, ?, ?)',
      't_a', 'Kurze Łapki', 'pro', 'active', 0);
    run(ctx, `INSERT INTO web_users (id, email, tenant_id, role, lang, email_verified) VALUES (?, ?, ?, 'tenant_owner', ?, 1)`,
      'wu1', 'o@s.com', 't_a', 'pl');
    // content-plan-style campaign: empty body, links a template_key.
    run(ctx,
      `INSERT INTO platform_campaigns (id, kind, title, body, bodies_json, channels_json, schedule_kind, status, occasion_key, template_key, created_by, created_at, updated_at)
       VALUES (?, 'announcement', 'X', '', '{"center":""}', ?, 'now', 'active', 'summer_start', 'seasonal_summer_start', 'op', 1, 1)`,
      'pc_tpl', JSON.stringify(['center']));
    // approved PL template for that key.
    run(ctx,
      `INSERT INTO platform_message_templates (id, name, status, template_key, locale, bodies_json, is_builtin, created_at, updated_at)
       VALUES ('t_pl', 'Lato', 'approved', 'seasonal_summer_start', 'pl', ?, 0, 1, 1)`,
      JSON.stringify({ center: 'Lato w {salon_name}! ☀️' }));

    await phasePlatformCampaigns(ctx, Date.now());
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toContain('Lato w Kurze Łapki');
  });
});
