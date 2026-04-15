/**
 * Tests for invoice email: sendInvoiceEmail + invoice.payment_succeeded webhook handler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendInvoiceEmail } from '../src/billing/invoiceEmail.js';
import { handleStripeWebhook } from '../src/billing/webhooks.js';
import { putTenant, getTenant } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { nowSec } from '../src/utils/time.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(overrides = {}) {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, resendApiKey: 'resend_test', resendFrom: 'ManicBot <noreply@manicbot.com>', ...overrides };
}

async function seedAll(ctx, { tenantId = 't_test', customerId = 'cus_test', plan = 'pro', billingEmail = null } = {}) {
  // seed tenant
  ctx.db._getTable('tenants').push({ id: tenantId, name: 'Test Salon', plan, billing_email: billingEmail, active: 1, createdAt: nowSec(), updatedAt: nowSec() });
  // seed stripe_customers
  ctx.db._getTable('stripe_customers').push({ customer_id: customerId, tenant_id: tenantId });
  // seed verified web_user
  ctx.db._getTable('web_users').push({
    id: 'wu_1', email: 'owner@salon.pl', password_hash: null,
    role: 'tenant_owner', tenant_id: tenantId, email_verified: 1,
    lang: 'pl', created_at: nowSec(), updated_at: nowSec(), tos_accepted_at: nowSec(),
  });
  return { tenantId, customerId };
}

async function signPayload(payload, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${raw}`));
  const v1 = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { signature: `t=${ts},v1=${v1}`, raw };
}

const SECRET = 'whsec_invoice_test';

async function fireWebhook(ctx, event) {
  const payload = JSON.stringify(event);
  const { signature } = await signPayload(payload, SECRET);
  return handleStripeWebhook(ctx, payload, signature, SECRET);
}

// ─── sendInvoiceEmail unit tests ──────────────────────────────────────────────

describe('sendInvoiceEmail', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when resendKey is missing', async () => {
    const ctx = makeCtx({ resendApiKey: null });
    const result = await sendInvoiceEmail(ctx, null, 'from@test.com', 't_test', {});
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false when tenantId is missing', async () => {
    const ctx = makeCtx();
    const result = await sendInvoiceEmail(ctx, 'key', 'from@test.com', '', {});
    expect(result).toBe(false);
  });

  it('returns false when no email can be resolved', async () => {
    const ctx = makeCtx();
    // no web_users, no billing_email
    ctx.db._getTable('tenants').push({ id: 't_empty', name: 'No Email', plan: 'pro', billing_email: null });
    const result = await sendInvoiceEmail(ctx, 'key', 'from@test.com', 't_empty', {});
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends email to verified web_user email (preferred over billing_email)', async () => {
    const ctx = makeCtx();
    await seedAll(ctx, { tenantId: 't_x', customerId: 'cus_x', billingEmail: 'billing@old.com' });

    const result = await sendInvoiceEmail(ctx, 'resend_key', 'ManicBot <noreply@manicbot.com>', 't_x', {
      amount_paid: 6000,
      currency: 'pln',
      period_start: nowSec() - 30 * 86400,
      period_end: nowSec(),
      hosted_invoice_url: 'https://invoice.stripe.com/test',
      number: 'INV-001',
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual(['owner@salon.pl']); // web_user, not billing@old.com
    expect(body.subject).toContain('INV-001');
    expect(body.html).toContain('60,00');       // 6000 grosz = 60 zł
    expect(body.html).toContain('Pro');          // plan name
    expect(body.html).toContain('invoice.stripe.com'); // hosted link
  });

  it('falls back to billing_email when no verified web_user', async () => {
    const ctx = makeCtx();
    ctx.db._getTable('tenants').push({ id: 't_fallback', name: 'Fallback Salon', plan: 'start', billing_email: 'billing@salon.pl' });

    const result = await sendInvoiceEmail(ctx, 'key', 'from@test.com', 't_fallback', {
      amount_paid: 4500, currency: 'pln',
      period_start: nowSec() - 86400, period_end: nowSec(),
    });

    expect(result).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(['billing@salon.pl']);
  });

  it('uses correct language from web_user.lang', async () => {
    const ctx = makeCtx();
    // seed English user
    ctx.db._getTable('tenants').push({ id: 't_en', name: 'English Salon', plan: 'pro', billing_email: null });
    ctx.db._getTable('web_users').push({
      id: 'wu_en', email: 'en@salon.com', role: 'tenant_owner', tenant_id: 't_en',
      email_verified: 1, lang: 'en', created_at: nowSec(), updated_at: nowSec(), tos_accepted_at: nowSec(),
    });

    await sendInvoiceEmail(ctx, 'key', 'from@test.com', 't_en', {
      amount_paid: 9000, currency: 'pln',
      period_start: nowSec() - 86400, period_end: nowSec(),
      number: 'EN-001',
      hosted_invoice_url: 'https://invoice.stripe.com/en001',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toContain('Invoice');        // English subject
    expect(body.html).toContain('Payment successful'); // English heading
    expect(body.html).toContain('View invoice');       // CTA button present (needs hosted_invoice_url)
  });

  it('does not include invoice link when hosted_invoice_url is absent', async () => {
    const ctx = makeCtx();
    await seedAll(ctx);

    await sendInvoiceEmail(ctx, 'key', 'from@test.com', 't_test', {
      amount_paid: 4500, currency: 'pln',
      period_start: nowSec() - 86400, period_end: nowSec(),
      // no hosted_invoice_url
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).not.toContain('invoice.stripe.com');
  });

  it('returns false on Resend API error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'Unprocessable' });
    const ctx = makeCtx();
    await seedAll(ctx);

    const result = await sendInvoiceEmail(ctx, 'key', 'from@test.com', 't_test', {
      amount_paid: 6000, currency: 'pln',
      period_start: nowSec() - 86400, period_end: nowSec(),
    });
    expect(result).toBe(false);
  });
});

// ─── invoice.payment_succeeded webhook handler ────────────────────────────────

describe('handleStripeWebhook — invoice.payment_succeeded', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('returns 200 and triggers invoice email when Resend is configured', async () => {
    const ctx = makeCtx();
    await seedAll(ctx);

    const event = {
      id: 'evt_inv_ok',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          customer: 'cus_test',
          amount_paid: 6000,
          currency: 'pln',
          period_start: nowSec() - 86400,
          period_end: nowSec(),
          number: 'MB-001',
          hosted_invoice_url: 'https://invoice.stripe.com/mb001',
        },
      },
    };

    const r = await fireWebhook(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });

    // Give fire-and-forget a tick to resolve
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns 200 silently when Resend is not configured', async () => {
    const ctx = makeCtx({ resendApiKey: null, resendFrom: null });
    await seedAll(ctx);

    const event = {
      id: 'evt_inv_noresend',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_test', amount_paid: 6000, currency: 'pln', period_start: 0, period_end: 0 } },
    };

    const r = await fireWebhook(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 when customer not in stripe_customers (no email, no crash)', async () => {
    const ctx = makeCtx();
    // no stripe_customers seeded

    const event = {
      id: 'evt_inv_unknown',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_unknown', amount_paid: 6000, currency: 'pln', period_start: 0, period_end: 0 } },
    };

    const r = await fireWebhook(ctx, event);
    expect(r).toMatchObject({ ok: true, status: 200 });
  });

  it('does not affect billing status (read-only for this event type)', async () => {
    const ctx = makeCtx();
    await seedAll(ctx, { tenantId: 't_inv_ro' });
    ctx.db._getTable('tenants')[0].billingStatus = 'active';

    const event = {
      id: 'evt_inv_ro',
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_test', amount_paid: 6000, currency: 'pln', period_start: 0, period_end: 0 } },
    };

    await fireWebhook(ctx, event);

    const tenant = await getTenant(ctx, 't_inv_ro');
    expect(tenant?.billingStatus ?? 'active').toBe('active'); // unchanged
  });
});
