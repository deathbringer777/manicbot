/**
 * reactiveMessaging.fireReactiveMessage — event-driven (webhook) delivery of
 * system/billing messages through the SAME platform_campaign_deliveries ledger
 * the cron dispatch uses.
 *
 * Covers: template resolution (tenant locale → EN fallback → first available),
 * variable interpolation + missing-variable hard fail, the MESSAGING_SEND_ENABLED
 * gate (off → 'skipped_flag' ledger row + zero egress), and ledger idempotency
 * (double fire → single delivery).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeCtx } from './helpers/mock-db.js';

const { fireReactiveMessage, resolveTemplateBodies, fireReactiveForTenant } = await import('../src/services/reactiveMessaging.js');

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const run = (ctx, sql, ...b) => ctx.db.prepare(sql).bind(...b).run();
const all = async (ctx, sql, ...b) => (await ctx.db.prepare(sql).bind(...b).all()).results;

function makeReactiveCtx(tenantId = 't_a', sendEnabled = true) {
  const ctx = makeCtx({ tenantId });
  ctx.env = { MESSAGING_SEND_ENABLED: sendEnabled ? '1' : '0' };
  return ctx;
}

function seedTemplate(ctx, { key, locale, center, variables }) {
  return run(ctx,
    `INSERT INTO platform_message_templates (id, name, category, channels_json, bodies_json, locale, is_builtin, status, template_key, variables_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `pmt_${key}_${locale}`, `${key} ${locale}`, 'billing', '["center"]',
    JSON.stringify({ center }), locale, 0, 'approved', key,
    variables ? JSON.stringify(variables) : null, 1000, 1000);
}

const recipient = { id: 'wu_owner', lang: 'pl', name: 'Anna Kowalska', email: 'a@s.com', email_verified: 1 };

describe('resolveTemplateBodies', () => {
  it('prefers the tenant locale row', async () => {
    const ctx = makeReactiveCtx();
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'Płatność nieudana, {salon_name}' });
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'en', center: 'Payment failed, {salon_name}' });
    const tpl = await resolveTemplateBodies(ctx, 'sys_payment_failed', 'pl');
    expect(tpl.locale).toBe('pl');
    expect(tpl.bodies.center).toContain('Płatność');
  });

  it('falls back to EN when the tenant locale is missing', async () => {
    const ctx = makeReactiveCtx();
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'en', center: 'Payment failed' });
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'ru', center: 'Платёж не прошёл' });
    const tpl = await resolveTemplateBodies(ctx, 'sys_payment_failed', 'uk');
    expect(tpl.locale).toBe('en');
  });

  it('returns null when no approved template exists for the key', async () => {
    const ctx = makeReactiveCtx();
    // draft rows must not resolve
    run(ctx,
      `INSERT INTO platform_message_templates (id, name, status, template_key, locale, bodies_json, is_builtin, created_at, updated_at)
       VALUES ('x','x','draft','sys_unknown','en','{"center":"hi"}',0,1,1)`);
    const tpl = await resolveTemplateBodies(ctx, 'sys_unknown', 'en');
    expect(tpl).toBeNull();
  });
});

describe('fireReactiveMessage', () => {
  it('delivers to the center channel and records a sent ledger row when the flag is on', async () => {
    const ctx = makeReactiveCtx('t_a', true);
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'Płatność nieudana dla {salon_name}', variables: ['salon_name'] });

    const res = await fireReactiveMessage(ctx, {
      kind: 'sys_payment_failed',
      occurrenceKey: 'in_123',
      recipients: [recipient],
      vars: { salon_name: 'Salon Kurze Łapki' },
      channels: ['center'],
    });

    expect(res.delivered).toBe(1);
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.length).toBe(1);
    expect(ledger[0].status).toBe('sent');
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(1);
    expect(msgs[0].body).toContain('Kurze Łapki');
  });

  it('writes a skipped_flag ledger row and performs ZERO egress when the flag is off', async () => {
    const ctx = makeReactiveCtx('t_a', false);
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'x {salon_name}', variables: ['salon_name'] });

    const res = await fireReactiveMessage(ctx, {
      kind: 'sys_payment_failed',
      occurrenceKey: 'in_123',
      recipients: [recipient],
      vars: { salon_name: 'S' },
      channels: ['center'],
    });

    expect(res.delivered).toBe(0);
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.length).toBe(1);
    expect(ledger[0].status).toBe('skipped_flag');
    // zero egress: no message row written, no telegram fetch
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is idempotent — firing the same (kind, occurrence, recipient, channel) twice delivers once', async () => {
    const ctx = makeReactiveCtx('t_a', true);
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'x {salon_name}', variables: ['salon_name'] });
    const args = {
      kind: 'sys_payment_failed', occurrenceKey: 'in_123',
      recipients: [recipient], vars: { salon_name: 'S' }, channels: ['center'],
    };
    await fireReactiveMessage(ctx, args);
    const res2 = await fireReactiveMessage(ctx, args);
    expect(res2.delivered).toBe(0); // second fire claims nothing
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.length).toBe(1);
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(1);
  });

  it('hard-fails when a declared variable is missing from vars', async () => {
    const ctx = makeReactiveCtx('t_a', true);
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'x {amount}', variables: ['amount'] });
    await expect(fireReactiveMessage(ctx, {
      kind: 'sys_payment_failed', occurrenceKey: 'in_1',
      recipients: [recipient], vars: {}, channels: ['center'],
    })).rejects.toThrow(/missing.*amount/i);
  });

  it('does nothing (no throw) when no template is found for the kind', async () => {
    const ctx = makeReactiveCtx('t_a', true);
    const res = await fireReactiveMessage(ctx, {
      kind: 'sys_nonexistent', occurrenceKey: 'o1',
      recipients: [recipient], vars: {}, channels: ['center'],
    });
    expect(res.delivered).toBe(0);
    expect(res.skipped).toBe('no_template');
  });
});

describe('fireReactiveForTenant', () => {
  function seedTenant(ctx, { id, name = 'Salon', plan = 'pro', is_test = 0 }) {
    return run(ctx, 'INSERT INTO tenants (id, name, plan, is_test) VALUES (?, ?, ?, ?)', id, name, plan, is_test);
  }
  function seedOwner(ctx, { id, tenant_id, lang = 'pl', name = 'Anna' }) {
    return run(ctx,
      `INSERT INTO web_users (id, email, tenant_id, role, lang, email_verified) VALUES (?, ?, ?, 'tenant_owner', ?, 1)`,
      id, `${id}@s.com`, tenant_id, lang);
  }

  it('resolves owner recipients and delivers a localized message (flag on)', async () => {
    const ctx = makeReactiveCtx('t_a', true);
    seedTenant(ctx, { id: 't_a', name: 'Kurze Łapki' });
    seedOwner(ctx, { id: 'wu1', tenant_id: 't_a', lang: 'pl' });
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: '{salon_name}: płatność nieudana', variables: ['salon_name'] });

    const res = await fireReactiveForTenant(ctx, 't_a', { kind: 'sys_payment_failed', occurrenceKey: 'in_9' });
    expect(res.delivered).toBeGreaterThan(0);
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs[0].body).toContain('Kurze Łapki');
  });

  it('skips test tenants entirely (no ledger rows)', async () => {
    const ctx = makeReactiveCtx('t_test', true);
    seedTenant(ctx, { id: 't_test', is_test: 1 });
    seedOwner(ctx, { id: 'wu2', tenant_id: 't_test' });
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'x {salon_name}', variables: ['salon_name'] });

    const res = await fireReactiveForTenant(ctx, 't_test', { kind: 'sys_payment_failed', occurrenceKey: 'in_1' });
    expect(res.skipped).toBe('test_tenant');
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.length).toBe(0);
  });

  it('stages (skipped_flag) with zero egress when the flag is off', async () => {
    const ctx = makeReactiveCtx('t_a', false);
    seedTenant(ctx, { id: 't_a' });
    seedOwner(ctx, { id: 'wu1', tenant_id: 't_a', lang: 'pl' });
    seedTemplate(ctx, { key: 'sys_payment_failed', locale: 'pl', center: 'x {salon_name}', variables: ['salon_name'] });

    const res = await fireReactiveForTenant(ctx, 't_a', { kind: 'sys_payment_failed', occurrenceKey: 'in_1' });
    expect(res.delivered).toBe(0);
    const ledger = await all(ctx, 'SELECT * FROM platform_campaign_deliveries');
    expect(ledger.every((r) => r.status === 'skipped_flag')).toBe(true);
    const msgs = await all(ctx, 'SELECT * FROM platform_thread_messages');
    expect(msgs.length).toBe(0);
  });
});
