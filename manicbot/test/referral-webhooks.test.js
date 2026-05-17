/**
 * Worker webhook integration tests for the referral program (PR-B).
 *
 * Covers:
 *   - happy path: invoice.paid + clean fraud → reward issued + Stripe credit posted
 *   - subscription with no referralId → no-op
 *   - billing_reason != 'subscription_create' → no-op (renewals don't fire)
 *   - already-processed referral (status='rewarded') → idempotent no-op
 *   - fraud_block: invalidates referral, NO Stripe call made
 *   - clawback within 30d: reverses credit + flips reward status
 *   - cron: phaseReferralExpiry voids expired credits
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleReferralInvoicePaid,
  handleReferralSubscriptionDeleted,
  phaseReferralExpiry,
} from '../src/billing/referralWebhooks.js';

const NOW = 1_715_000_000;
const REFERRAL_ID = 'ref_abc';
const REFERRER = { web_user_id: 'w_owner', tenant_id: 't_owner', stripe_customer_id: 'cus_owner' };
const INVITEE = { web_user_id: 'w_invitee', tenant_id: 't_invitee', phone: '+48111222333' };

function makeCtx(overrides = {}) {
  const referrals = overrides.referrals ?? [{
    id: REFERRAL_ID,
    referrer_web_user_id: REFERRER.web_user_id,
    referrer_tenant_id: REFERRER.tenant_id,
    invitee_web_user_id: INVITEE.web_user_id,
    invitee_tenant_id: INVITEE.tenant_id,
    code: 'OWNE-AB23K',
    status: 'pending',
    first_invoice_paid_at: null,
    reward_id: null,
    invitee_payment_method_fp: null,
    updated_at: NOW - 86400,
  }];
  const rewards = overrides.rewards ?? [];
  const events = [];
  // SQL aliases `created_at AS webUserCreatedAt`; mock honors the alias.
  const webUsers = overrides.webUsers ?? [
    { id: INVITEE.web_user_id, webUserCreatedAt: NOW - 7 * 86400, phone: null },
    { id: REFERRER.web_user_id, webUserCreatedAt: NOW - 30 * 86400, phone: null },
  ];
  const tenants = overrides.tenants ?? [
    { id: REFERRER.tenant_id, plan: 'pro', stripe_customer_id: REFERRER.stripe_customer_id },
  ];
  const fingerprintHits = overrides.fingerprintHits ?? [];

  const db = {
    prepare(sql) {
      let params = [];
      return {
        bind(...p) { params = p; return this; },
        async first() {
          if (/FROM referrals WHERE id = \?/i.test(sql)) {
            return referrals.find((r) => r.id === params[0]) ?? null;
          }
          if (/FROM web_users WHERE id = \?/i.test(sql)) {
            return webUsers.find((u) => u.id === params[0]) ?? null;
          }
          if (/FROM web_users WHERE phone = \? AND id != \? AND id != \?/i.test(sql)) {
            return webUsers.find((u) => u.phone === params[0] && u.id !== params[1] && u.id !== params[2]) ?? null;
          }
          if (/COUNT\(\*\)/i.test(sql) && /referral_rewards/i.test(sql)) {
            // referrer rewards counter — caller passes the cutoff timestamp.
            const cutoff = params[params.length - 1];
            const since = rewards.filter((r) =>
              r.referrer_web_user_id === params[0] &&
              ['pending', 'applied'].includes(r.status) &&
              r.created_at > cutoff
            ).length;
            return { n: since };
          }
          if (/FROM referral_rewards WHERE id = \?/i.test(sql)) {
            return rewards.find((r) => r.id === params[0]) ?? null;
          }
          if (/FROM tenants WHERE id = \?/i.test(sql)) {
            return tenants.find((t) => t.id === params[0]) ?? null;
          }
          return null;
        },
        async all() {
          if (/FROM referrals WHERE invitee_payment_method_fp = \?/i.test(sql)) {
            return { results: fingerprintHits };
          }
          if (/FROM referral_rewards WHERE status = \? AND expires_at < \?/i.test(sql)) {
            const cutoff = params[1];
            return { results: rewards.filter((r) => r.status === params[0] && r.expires_at < cutoff) };
          }
          return { results: [] };
        },
        async run() {
          if (/^UPDATE referrals/i.test(sql)) {
            // params order: SET cols then WHERE id at the END
            const id = params[params.length - 1];
            const row = referrals.find((r) => r.id === id);
            if (row) {
              // Status update covers: pending→first_paid, pending→invalidated, →rewarded, →clawback
              if (/SET status = \?, first_invoice_paid_at = \?, invitee_payment_method_fp = \?, fraud_flags/i.test(sql)) {
                row.status = params[0];
                row.first_invoice_paid_at = params[1];
                row.invitee_payment_method_fp = params[2];
                row.fraud_flags = params[3];
                row.updated_at = params[4];
              } else if (/SET status = \?, first_invoice_paid_at = \?, invitee_payment_method_fp = \?, updated_at/i.test(sql)) {
                row.status = params[0];
                row.first_invoice_paid_at = params[1];
                row.invitee_payment_method_fp = params[2];
                row.updated_at = params[3];
              } else if (/SET status = \?, reward_id = \?, updated_at/i.test(sql)) {
                row.status = params[0];
                row.reward_id = params[1];
                row.updated_at = params[2];
              } else if (/SET status = \?, updated_at/i.test(sql)) {
                row.status = params[0];
                row.updated_at = params[1];
              }
            }
          }
          if (/INSERT INTO referral_rewards/i.test(sql)) {
            rewards.push({
              id: params[0],
              referrer_web_user_id: params[1],
              referrer_tenant_id: params[2],
              referral_id: params[3],
              kind: params[4],
              amount_grosz: params[5],
              stripe_customer_id: params[6],
              expires_at: params[7],
              status: params[8],
              created_at: params[9],
            });
          }
          if (/^UPDATE referral_rewards/i.test(sql)) {
            const id = params[params.length - 1];
            const row = rewards.find((r) => r.id === id);
            if (row) {
              if (/SET status = \?, applied_at = \?, stripe_balance_transaction/i.test(sql)) {
                row.status = params[0];
                row.applied_at = params[1];
                row.stripe_balance_transaction = params[2];
              } else if (/SET status = \?/i.test(sql)) {
                row.status = params[0];
              }
            }
          }
          if (/INSERT INTO referral_events/i.test(sql)) {
            events.push({
              referral_id: params[0],
              reward_id: params[1],
              event: params[2],
              metadata: params[3],
            });
          }
          return { success: true };
        },
      };
    },
  };
  return { ctx: { db, stripeSecretKey: 'sk_test_xx' }, state: { referrals, rewards, events } };
}

function makeFetchSequence(...responses) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++ % responses.length];
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  });
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

import { afterEach } from 'vitest';

const SUB_WITH_REF = { id: 'sub_x', metadata: { referralId: REFERRAL_ID } };
const PI_WITH_FP = { id: 'pi_x', payment_method: { card: { fingerprint: 'fp_abc' } } };

describe('handleReferralInvoicePaid', () => {
  it('happy path: clean fraud, reward issued + Stripe credit posted', async () => {
    const { ctx, state } = makeCtx();
    vi.stubGlobal('fetch', makeFetchSequence(
      { body: SUB_WITH_REF },          // GET /subscriptions/...
      { body: PI_WITH_FP },             // GET /payment_intents/...
      { body: { id: 'cbt_123', amount: -6000 } }, // POST balance_transactions
    ));

    await handleReferralInvoicePaid(ctx, {
      subscription: 'sub_x',
      payment_intent: 'pi_x',
      billing_reason: 'subscription_create',
    });

    expect(state.referrals[0].status).toBe('rewarded');
    expect(state.referrals[0].invitee_payment_method_fp).toBe('fp_abc');
    expect(state.rewards.length).toBe(1);
    expect(state.rewards[0].amount_grosz).toBe(6000); // pro plan
    expect(state.rewards[0].status).toBe('applied');
    expect(state.rewards[0].stripe_balance_transaction).toBe('cbt_123');
    const events = state.events.map((e) => e.event);
    expect(events).toContain('invitee_first_paid');
    expect(events).toContain('reward_issued');
  });

  it('no-op when subscription has no referralId', async () => {
    const { ctx, state } = makeCtx();
    vi.stubGlobal('fetch', makeFetchSequence(
      { body: { id: 'sub_y', metadata: {} } },
    ));
    await handleReferralInvoicePaid(ctx, {
      subscription: 'sub_y',
      payment_intent: 'pi_y',
      billing_reason: 'subscription_create',
    });
    expect(state.referrals[0].status).toBe('pending');
    expect(state.rewards.length).toBe(0);
  });

  it('skips renewals (billing_reason != subscription_create)', async () => {
    const { ctx, state } = makeCtx();
    vi.stubGlobal('fetch', vi.fn());
    await handleReferralInvoicePaid(ctx, {
      subscription: 'sub_x',
      payment_intent: 'pi_x',
      billing_reason: 'subscription_cycle',
    });
    expect(state.referrals[0].status).toBe('pending');
    expect(state.rewards.length).toBe(0);
  });

  it('idempotent: status != pending → returns without action', async () => {
    const { ctx, state } = makeCtx({
      referrals: [{
        ...({
          id: REFERRAL_ID,
          referrer_web_user_id: REFERRER.web_user_id,
          referrer_tenant_id: REFERRER.tenant_id,
          invitee_web_user_id: INVITEE.web_user_id,
          invitee_tenant_id: INVITEE.tenant_id,
          code: 'OWNE-AB23K',
          status: 'rewarded',
          first_invoice_paid_at: NOW - 100,
          reward_id: 'rw_existing',
          invitee_payment_method_fp: 'fp_abc',
          updated_at: NOW - 100,
        }),
      }],
    });
    vi.stubGlobal('fetch', makeFetchSequence({ body: SUB_WITH_REF }));
    await handleReferralInvoicePaid(ctx, {
      subscription: 'sub_x',
      payment_intent: 'pi_x',
      billing_reason: 'subscription_create',
    });
    expect(state.rewards.length).toBe(0); // no new reward issued
  });

  it('fraud_block: fingerprint duplicate → invalidated, no Stripe credit', async () => {
    const fingerprintHits = [
      { id: 'ref_other', status: 'rewarded', inviteeWebUserId: 'w_someone_else' },
    ];
    const { ctx, state } = makeCtx({ fingerprintHits });
    const fetchMock = makeFetchSequence(
      { body: SUB_WITH_REF },
      { body: PI_WITH_FP },
    );
    vi.stubGlobal('fetch', fetchMock);

    await handleReferralInvoicePaid(ctx, {
      subscription: 'sub_x',
      payment_intent: 'pi_x',
      billing_reason: 'subscription_create',
    });

    expect(state.referrals[0].status).toBe('invalidated');
    const flags = JSON.parse(state.referrals[0].fraud_flags);
    expect(flags).toContain('duplicate_card_fingerprint');
    expect(state.rewards.length).toBe(0);
    // Only 2 fetches: subscription + payment_intent. No balance_transactions POST.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('signup_too_recent flag fires for <24h old invitee accounts', async () => {
    const { ctx, state } = makeCtx({
      webUsers: [
        { id: INVITEE.web_user_id, webUserCreatedAt: NOW - 3600, phone: null }, // 1h old
        { id: REFERRER.web_user_id, webUserCreatedAt: NOW - 30 * 86400, phone: null },
      ],
    });
    vi.stubGlobal('fetch', makeFetchSequence(
      { body: SUB_WITH_REF },
      { body: PI_WITH_FP },
    ));

    await handleReferralInvoicePaid(ctx, {
      subscription: 'sub_x',
      payment_intent: 'pi_x',
      billing_reason: 'subscription_create',
    });

    expect(state.referrals[0].status).toBe('invalidated');
    const flags = JSON.parse(state.referrals[0].fraud_flags);
    expect(flags).toContain('signup_too_recent');
  });
});

describe('handleReferralSubscriptionDeleted (30d clawback)', () => {
  it('reverses the credit when within 30d of first paid invoice', async () => {
    const { ctx, state } = makeCtx({
      referrals: [{
        id: REFERRAL_ID,
        referrer_web_user_id: REFERRER.web_user_id,
        referrer_tenant_id: REFERRER.tenant_id,
        invitee_web_user_id: INVITEE.web_user_id,
        invitee_tenant_id: INVITEE.tenant_id,
        code: 'OWNE-AB23K',
        status: 'rewarded',
        first_invoice_paid_at: NOW - 10 * 86400, // 10 days ago
        reward_id: 'rw_existing',
        invitee_payment_method_fp: 'fp_abc',
        updated_at: NOW - 10 * 86400,
      }],
      rewards: [{
        id: 'rw_existing',
        referrer_web_user_id: REFERRER.web_user_id,
        referrer_tenant_id: REFERRER.tenant_id,
        referral_id: REFERRAL_ID,
        kind: 'free_month',
        amount_grosz: 6000,
        stripe_customer_id: 'cus_owner',
        status: 'applied',
        applied_at: NOW - 10 * 86400,
        stripe_balance_transaction: 'cbt_old',
        created_at: NOW - 10 * 86400,
        expires_at: NOW + 365 * 86400,
      }],
    });
    const fetchMock = makeFetchSequence({ body: { id: 'cbt_reversal', amount: 6000 } });
    vi.stubGlobal('fetch', fetchMock);

    await handleReferralSubscriptionDeleted(ctx, { metadata: { referralId: REFERRAL_ID } });

    expect(state.referrals[0].status).toBe('clawback');
    expect(state.rewards[0].status).toBe('clawed_back');
    expect(fetchMock).toHaveBeenCalledTimes(1); // one POST to balance_transactions
  });

  it('no-op outside 30d window', async () => {
    const { ctx, state } = makeCtx({
      referrals: [{
        id: REFERRAL_ID,
        referrer_web_user_id: REFERRER.web_user_id,
        referrer_tenant_id: REFERRER.tenant_id,
        invitee_web_user_id: INVITEE.web_user_id,
        invitee_tenant_id: INVITEE.tenant_id,
        code: 'OWNE-AB23K',
        status: 'rewarded',
        first_invoice_paid_at: NOW - 60 * 86400, // 60 days ago
        reward_id: 'rw_existing',
        invitee_payment_method_fp: 'fp_abc',
        updated_at: NOW - 60 * 86400,
      }],
      rewards: [{
        id: 'rw_existing',
        referrer_web_user_id: REFERRER.web_user_id,
        referrer_tenant_id: REFERRER.tenant_id,
        referral_id: REFERRAL_ID,
        kind: 'free_month',
        amount_grosz: 6000,
        stripe_customer_id: 'cus_owner',
        status: 'applied',
        applied_at: NOW - 60 * 86400,
        stripe_balance_transaction: 'cbt_old',
        created_at: NOW - 60 * 86400,
        expires_at: NOW + 365 * 86400,
      }],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await handleReferralSubscriptionDeleted(ctx, { metadata: { referralId: REFERRAL_ID } });

    expect(state.referrals[0].status).toBe('rewarded'); // unchanged
    expect(state.rewards[0].status).toBe('applied'); // unchanged
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('phaseReferralExpiry', () => {
  it('voids applied rewards past their expires_at', async () => {
    const { ctx, state } = makeCtx({
      rewards: [{
        id: 'rw_expired',
        referrer_web_user_id: REFERRER.web_user_id,
        referrer_tenant_id: REFERRER.tenant_id,
        referral_id: REFERRAL_ID,
        kind: 'free_month',
        amount_grosz: 6000,
        stripe_customer_id: 'cus_owner',
        status: 'applied',
        applied_at: NOW - 366 * 86400,
        stripe_balance_transaction: 'cbt_old',
        created_at: NOW - 366 * 86400,
        expires_at: NOW - 86400, // expired yesterday
      }],
    });
    const fetchMock = makeFetchSequence({ body: { id: 'cbt_void', amount: 6000 } });
    vi.stubGlobal('fetch', fetchMock);

    const r = await phaseReferralExpiry(ctx);
    expect(r.processed).toBe(1);
    expect(r.errors).toBe(0);
    expect(state.rewards[0].status).toBe('expired');
    const events = state.events.map((e) => e.event);
    expect(events).toContain('reward_voided');
  });

  it('no-op when nothing is expired', async () => {
    const { ctx } = makeCtx({
      rewards: [{
        id: 'rw_fresh',
        referrer_web_user_id: REFERRER.web_user_id,
        referrer_tenant_id: REFERRER.tenant_id,
        referral_id: REFERRAL_ID,
        kind: 'free_month',
        amount_grosz: 6000,
        stripe_customer_id: 'cus_owner',
        status: 'applied',
        applied_at: NOW - 30 * 86400,
        stripe_balance_transaction: 'cbt',
        created_at: NOW - 30 * 86400,
        expires_at: NOW + 365 * 86400,
      }],
    });
    vi.stubGlobal('fetch', vi.fn());
    const r = await phaseReferralExpiry(ctx);
    expect(r.processed).toBe(0);
    expect(r.errors).toBe(0);
  });
});
