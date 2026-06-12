/**
 * runCampaignSend billing gate (post-fix verification 2026-06-12, V-1).
 *
 * The admin-app gates `campaignSendNow` / `automationRunNow` with
 * `assertTenantBillingActive`, but a locked tenant could still SCHEDULE a
 * campaign (`campaignCreate({ scheduledAt })`, ungated) — the worker cron
 * `phaseMarketingDispatch` then dispatched it with no billing check, fully
 * bypassing the marketing-send gate. The automation event path
 * (`fireAutomationForEvent` → `runCampaignSend`) had the same hole.
 *
 * Fix: `runCampaignSend` itself reads the campaign tenant's `billing_status`
 * (by `campaign.tenant_id`, NOT a possibly-unloaded `ctx.tenant`, so it can
 * never fail open) and refuses to send for an inactive/canceled tenant. This
 * is the universal chokepoint — every worker send path routes through it.
 */
import { describe, it, expect, vi } from 'vitest';
import { runCampaignSend } from '../src/services/marketing/sender.js';

/**
 * Build a ctx whose db answers:
 *   - SELECT * FROM marketing_campaigns  → the given campaign row
 *   - SELECT billing_status FROM tenants → { billing_status }
 *   - everything else                    → null / empty
 * Records every mutating SQL so we can assert "no send happened".
 */
function makeCtx({ campaign, billingStatus }) {
  const mutations = [];
  return {
    ctx: {
      db: {
        prepare(sql) {
          return {
            _args: null,
            bind(...args) { this._args = args; return this; },
            async first() {
              if (/FROM marketing_campaigns/i.test(sql)) return campaign ?? null;
              if (/billing_status[\s\S]*FROM tenants/i.test(sql)) {
                return billingStatus === undefined ? null : { billing_status: billingStatus };
              }
              return null;
            },
            async all() { return { results: [] }; },
            async run() { mutations.push(sql); return { meta: { changes: 1 } }; },
          };
        },
      },
    },
    mutations,
  };
}

const campaign = (over = {}) => ({
  id: 'cmp_1',
  tenant_id: 't_locked',
  status: 'scheduled',
  scheduled_at: 1,
  channel: 'email',
  template_id: 'tpl_1',
  ...over,
});

describe('runCampaignSend — billing gate (V-1)', () => {
  it('refuses to send for an inactive tenant (billing_locked, no status flip)', async () => {
    const { ctx, mutations } = makeCtx({ campaign: campaign(), billingStatus: 'inactive' });
    const r = await runCampaignSend(ctx, 't_locked', 'cmp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('billing_locked');
    // Must bail BEFORE flipping the campaign to 'sending' or inserting sends.
    expect(mutations.join(' ')).not.toMatch(/UPDATE marketing_campaigns SET status = 'sending'/i);
  });

  it('refuses to send for a canceled tenant', async () => {
    const { ctx } = makeCtx({ campaign: campaign(), billingStatus: 'canceled' });
    const r = await runCampaignSend(ctx, 't_locked', 'cmp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('billing_locked');
  });

  it('does NOT block an active tenant on the billing check', async () => {
    const { ctx } = makeCtx({ campaign: campaign({ tenant_id: 't_ok' }), billingStatus: 'active' });
    const r = await runCampaignSend(ctx, 't_ok', 'cmp_1');
    // It may still fail later (no audience/template wiring in this mock), but
    // the failure must NOT be the billing gate.
    expect(r.error).not.toBe('billing_locked');
  });

  it('does NOT block a trialing tenant', async () => {
    const { ctx } = makeCtx({ campaign: campaign({ tenant_id: 't_trial' }), billingStatus: 'trialing' });
    const r = await runCampaignSend(ctx, 't_trial', 'cmp_1');
    expect(r.error).not.toBe('billing_locked');
  });
});
