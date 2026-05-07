/**
 * Tests for the plugin add-on webhook handlers in
 * src/billing/pluginWebhooks.js.
 *
 * We stub ctx.db.prepare().bind().all/first/run to capture queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleAddonCheckoutCompleted,
  handleAddonInvoicePaid,
  handleAddonInvoiceFailed,
  handleAddonSubscriptionCanceled,
} from '../src/billing/pluginWebhooks.js';

// ─── Minimal D1 mock that serves the exact SELECT/UPDATE/INSERT this file uses ─

function makeCtx(initialInstallations = [], opts = {}) {
  const installations = [...initialInstallations];
  const events = [];
  const queries = [];
  // #P1-7 — resolveAddonTenant looks up stripe_customers (customer_id →
  // tenant_id) and tenants (tenant existence). Tests can seed both.
  const stripeCustomers = opts.stripeCustomers ?? []; // [{ customer_id, tenant_id }]
  const tenants = opts.tenants ?? installations
    .map((i) => i.tenant_id)
    .filter((t) => t)
    .map((id) => ({ id }));

  const db = {
    prepare(sql) {
      let params = [];
      return {
        bind(...p) {
          params = p;
          return this;
        },
        async first() {
          queries.push({ kind: 'first', sql, params });
          // SELECT tenant_id FROM stripe_customers WHERE customer_id = ?
          if (/stripe_customers.*customer_id = \?/i.test(sql)) {
            const [cid] = params;
            const row = stripeCustomers.find((s) => s.customer_id === cid);
            return row ? { tenant_id: row.tenant_id } : null;
          }
          // SELECT id FROM tenants WHERE id = ? LIMIT 1
          if (/FROM tenants WHERE id = \?/i.test(sql)) {
            const [tid] = params;
            const row = tenants.find((t) => t.id === tid);
            return row ? { id: row.id } : null;
          }
          // SELECT id FROM plugin_installations WHERE plugin_slug = ? AND tenant_id = ?
          if (/plugin_installations.*plugin_slug = \?.*tenant_id = \?/i.test(sql)) {
            const [slug, tenantId] = params;
            const row = installations.find((i) => i.plugin_slug === slug && i.tenant_id === tenantId);
            return row ? { id: row.id } : null;
          }
          // SELECT id FROM plugin_installations WHERE plugin_slug = ? AND tenant_id IS NULL
          if (/plugin_installations.*plugin_slug = \?.*tenant_id IS NULL/i.test(sql)) {
            const [slug] = params;
            const row = installations.find((i) => i.plugin_slug === slug && i.tenant_id === null);
            return row ? { id: row.id } : null;
          }
          return null;
        },
        async all() {
          queries.push({ kind: 'all', sql, params });
          return { results: [] };
        },
        async run() {
          queries.push({ kind: 'run', sql, params });
          // UPDATE plugin_installations SET billing_state = ?, updated_at = ? ...
          if (/UPDATE plugin_installations/i.test(sql)) {
            const installId = params[params.length - 1];
            const row = installations.find((i) => i.id === installId);
            if (row) {
              row.billing_state = params[0];
              row.updated_at = params[1];
              // Optional extra fields
              const sqlParts = sql.split(',').map((s) => s.trim());
              let pIdx = 2;
              for (const part of sqlParts) {
                if (part.includes('stripe_subscription_item_id')) {
                  row.stripe_subscription_item_id = params[pIdx++];
                } else if (part.includes('stripe_payment_intent_id')) {
                  row.stripe_payment_intent_id = params[pIdx++];
                }
              }
            }
          }
          // INSERT INTO plugin_events ...
          if (/INSERT INTO plugin_events/i.test(sql)) {
            events.push({
              installation_id: params[0],
              event: params[1],
              actor_web_user_id: params[2],
              detail_json: params[3],
              created_at: params[4],
            });
          }
          return { success: true };
        },
      };
    },
  };

  return { ctx: { db }, state: { installations, events, queries } };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('handleAddonCheckoutCompleted — one-time purchase', () => {
  it('flips billing_state to paid when session carries plugin_slug', async () => {
    const { ctx, state } = makeCtx([
      { id: 'pi_tip', tenant_id: 't_1', plugin_slug: 'tip-jar', billing_state: 'trialing' },
    ]);
    const session = {
      metadata: { plugin_slug: 'tip-jar', tenantId: 't_1' },
      payment_intent: 'pi_stripe_123',
    };
    const r = await handleAddonCheckoutCompleted(ctx, session);
    expect(r.handled).toBe(true);
    expect(r.installationId).toBe('pi_tip');
    expect(state.installations[0].billing_state).toBe('paid');
    expect(state.installations[0].stripe_payment_intent_id).toBe('pi_stripe_123');
    expect(state.events.at(-1).event).toBe('billing_state_changed');
  });

  it('no-op when session has no plugin_slug', async () => {
    const { ctx } = makeCtx();
    const r = await handleAddonCheckoutCompleted(ctx, { metadata: {} });
    expect(r.handled).toBe(false);
  });

  it('uses platform install when no tenant-specific row exists', async () => {
    const { ctx, state } = makeCtx([
      { id: 'pi_plat', tenant_id: null, plugin_slug: 'shared-addon', billing_state: 'trialing' },
    ]);
    const r = await handleAddonCheckoutCompleted(ctx, {
      metadata: { plugin_slug: 'shared-addon' },
    });
    // Platform-wide install: no tenantId metadata, no customer. With
    // #P1-7 resolveAddonTenant returns null and the lookup falls through
    // to `tenant_id IS NULL` which matches the platform install row.
    expect(r.handled).toBe(true);
    expect(state.installations[0].billing_state).toBe('paid');
  });

  it('rejects unknown tenantId without a stripe_customers anchor', async () => {
    // #P1-7 — bare metadata.tenantId that doesn't exist in `tenants` MUST
    // be ignored: this is the prime injection vector closed by the change.
    const { ctx, state } = makeCtx([
      { id: 'pi_t1', tenant_id: 't_real', plugin_slug: 'sms-reminders', billing_state: 'trialing' },
    ], { tenants: [{ id: 't_real' }] });
    const r = await handleAddonCheckoutCompleted(ctx, {
      metadata: { plugin_slug: 'sms-reminders', tenantId: 't_spoof' },
    });
    expect(r.handled).toBe(false);
    expect(state.installations[0].billing_state).toBe('trialing');
  });

  it('rejects when metadata.tenantId conflicts with stripe_customers owner', async () => {
    // Attacker crafts a session for customer cus_t1 (owned by t_1) but with
    // metadata.tenantId = t_2. Should refuse the mutation entirely.
    const { ctx, state } = makeCtx(
      [
        { id: 'pi_t1', tenant_id: 't_1', plugin_slug: 'sms-reminders', billing_state: 'trialing' },
        { id: 'pi_t2', tenant_id: 't_2', plugin_slug: 'sms-reminders', billing_state: 'trialing' },
      ],
      { stripeCustomers: [{ customer_id: 'cus_t1', tenant_id: 't_1' }] },
    );
    const r = await handleAddonCheckoutCompleted(ctx, {
      metadata: { plugin_slug: 'sms-reminders', tenantId: 't_2' },
      customer: 'cus_t1',
      payment_intent: 'pi_x',
    });
    expect(r.handled).toBe(false);
    // Critically: t_1 install must NOT have been mutated either.
    expect(state.installations.find((i) => i.tenant_id === 't_1').billing_state).toBe('trialing');
    expect(state.installations.find((i) => i.tenant_id === 't_2').billing_state).toBe('trialing');
  });

  it('uses platform install when customer anchors to a known tenant', async () => {
    const { ctx, state } = makeCtx(
      [{ id: 'pi_plat', tenant_id: null, plugin_slug: 'shared-addon', billing_state: 'trialing' }],
      {
        stripeCustomers: [{ customer_id: 'cus_anchor', tenant_id: 't_owner' }],
        tenants: [{ id: 't_owner' }],
      },
    );
    const r = await handleAddonCheckoutCompleted(ctx, {
      metadata: { plugin_slug: 'shared-addon' },
      customer: 'cus_anchor',
    });
    // resolveAddonTenant returns 't_owner', no install for that tenant, falls
    // back to the platform-wide row.
    expect(r.handled).toBe(true);
    expect(state.installations[0].billing_state).toBe('paid');
  });
});

describe('handleAddonInvoicePaid — subscription item', () => {
  it('flips each line with plugin_slug metadata to paid', async () => {
    const { ctx, state } = makeCtx([
      { id: 'pi_sms', tenant_id: 't_1', plugin_slug: 'sms-reminders', billing_state: 'trialing' },
    ]);
    const invoice = {
      customer: 'cus_t1',
      lines: {
        data: [
          {
            subscription_item: 'si_abc',
            price: { metadata: { plugin_slug: 'sms-reminders', tenantId: 't_1' } },
          },
          {
            // unrelated line — plan subscription, no plugin_slug
            price: { metadata: {} },
          },
        ],
      },
    };
    // Anchor the customer to t_1 so resolveAddonTenant accepts the metadata.
    ctx.__seedStripeCustomer = (cid, tid) => {
      // unused — we'll re-create ctx with seeded customers
    };
    const { ctx: ctx2, state: state2 } = makeCtx(
      [{ id: 'pi_sms', tenant_id: 't_1', plugin_slug: 'sms-reminders', billing_state: 'trialing' }],
      { stripeCustomers: [{ customer_id: 'cus_t1', tenant_id: 't_1' }] },
    );
    const r = await handleAddonInvoicePaid(ctx2, invoice);
    expect(r.handled).toBe(true);
    expect(r.touched).toBe(1);
    expect(state2.installations[0].billing_state).toBe('paid');
    expect(state2.installations[0].stripe_subscription_item_id).toBe('si_abc');
    // Silence unused-var lint for the original ctx/state placeholders.
    void ctx; void state;
  });

  it('no-op when no lines carry plugin_slug', async () => {
    const { ctx } = makeCtx();
    const r = await handleAddonInvoicePaid(ctx, { lines: { data: [{ price: { metadata: {} } }] } });
    expect(r.handled).toBe(false);
  });
});

describe('handleAddonInvoiceFailed', () => {
  it('flips billing_state to past_due', async () => {
    const { ctx, state } = makeCtx(
      [{ id: 'pi_sms', tenant_id: 't_1', plugin_slug: 'sms-reminders', billing_state: 'paid' }],
      { stripeCustomers: [{ customer_id: 'cus_t1', tenant_id: 't_1' }] },
    );
    const invoice = {
      customer: 'cus_t1',
      lines: {
        data: [
          { price: { metadata: { plugin_slug: 'sms-reminders', tenantId: 't_1' } } },
        ],
      },
    };
    const r = await handleAddonInvoiceFailed(ctx, invoice);
    expect(r.handled).toBe(true);
    expect(state.installations[0].billing_state).toBe('past_due');
  });
});

describe('handleAddonSubscriptionCanceled', () => {
  it('flips every plugin item in the subscription to canceled', async () => {
    const { ctx, state } = makeCtx(
      [
        { id: 'pi_a', tenant_id: 't_1', plugin_slug: 'sms-reminders', billing_state: 'paid' },
        { id: 'pi_b', tenant_id: 't_1', plugin_slug: 'no-show-shield', billing_state: 'paid' },
      ],
      { stripeCustomers: [{ customer_id: 'cus_t1', tenant_id: 't_1' }] },
    );
    const sub = {
      customer: 'cus_t1',
      metadata: { tenantId: 't_1' },
      items: {
        data: [
          { price: { metadata: { plugin_slug: 'sms-reminders' } } },
          { price: { metadata: { plugin_slug: 'no-show-shield' } } },
        ],
      },
    };
    const r = await handleAddonSubscriptionCanceled(ctx, sub);
    expect(r.handled).toBe(true);
    expect(r.touched).toBe(2);
    expect(state.installations.every((i) => i.billing_state === 'canceled')).toBe(true);
  });

  it('ignores subscription without any plugin items', async () => {
    const { ctx } = makeCtx();
    const r = await handleAddonSubscriptionCanceled(ctx, {
      items: { data: [{ price: { metadata: {} } }] },
    });
    expect(r.handled).toBe(false);
  });
});

describe('Audit trail', () => {
  it('writes a plugin_events row on every billing_state_changed', async () => {
    const { ctx, state } = makeCtx(
      [{ id: 'pi_x', tenant_id: 't_1', plugin_slug: 'test', billing_state: 'trialing' }],
      { stripeCustomers: [{ customer_id: 'cus_t1', tenant_id: 't_1' }] },
    );
    await handleAddonCheckoutCompleted(ctx, {
      metadata: { plugin_slug: 'test', tenantId: 't_1' },
      customer: 'cus_t1',
      payment_intent: 'pi_ab',
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0].event).toBe('billing_state_changed');
    const detail = JSON.parse(state.events[0].detail_json);
    expect(detail.newState).toBe('paid');
    expect(detail.paymentIntentId).toBe('pi_ab');
  });
});
