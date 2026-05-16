/**
 * Referral program Worker webhook handlers (PR-B / migration 0069).
 *
 * Hooked into ../billing/webhooks.js dispatcher:
 *   - invoice.paid / invoice.payment_succeeded → handleReferralInvoicePaid
 *   - customer.subscription.deleted            → handleReferralSubscriptionDeleted
 *
 * Both are best-effort: never throw out of the main dispatcher (Stripe
 * retries are expensive — better to log + ack 200).
 *
 * Trigger: invoice.paid where billing_reason='subscription_create' AND the
 * subscription's metadata carries a referralId. Runs fraud assessment; on
 * clean, issues a `free_month` reward sized to the referrer's CURRENT plan
 * and posts a PLN credit to the referrer's Stripe customer_balance.
 */

import { dbGet, dbRun, dbAll } from '../utils/db.js';
import { nowSec } from '../utils/time.js';
import { log } from '../utils/logger.js';
import { assessReferralFraud } from './referralFraud.js';
import { createReferralCreditPLN, reverseReferralCreditPLN, PLAN_MONTHLY_GROSZ } from './referralCredits.js';

const DAY = 24 * 3600;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;
const CLAWBACK_WINDOW = 30 * DAY;

async function logReferralEvent(ctx, { referralId = null, rewardId = null, event, metadata = null }) {
  if (!ctx?.db) return;
  try {
    await dbRun(ctx,
      'INSERT INTO referral_events (referral_id, reward_id, event, metadata, created_at) VALUES (?, ?, ?, ?, ?)',
      referralId, rewardId, event, metadata ? JSON.stringify(metadata) : null, nowSec(),
    );
  } catch (e) {
    log.error('billing.referralWebhooks.audit', e instanceof Error ? e : new Error(String(e?.message)));
  }
}

/**
 * Lookup the payment method card fingerprint from an invoice. Stripe returns
 * `payment_intent` as a string id by default; we may need to expand. We
 * gracefully degrade to null if the fetch fails (fraud check still has the
 * other defenses).
 */
async function fetchPaymentFingerprint(ctx, invoice) {
  const paymentIntentId = typeof invoice.payment_intent === 'string'
    ? invoice.payment_intent
    : invoice.payment_intent?.id;
  if (!paymentIntentId || !ctx?.stripeSecretKey) return null;
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}?expand[]=payment_method`,
      { headers: { Authorization: `Bearer ${ctx.stripeSecretKey}` } },
    );
    if (!res.ok) return null;
    const pi = await res.json();
    const pm = pi?.payment_method;
    if (!pm || typeof pm === 'string') return null;
    return pm?.card?.fingerprint ?? null;
  } catch (e) {
    log.warn('billing.referralWebhooks.fp', { message: String(e?.message ?? e) });
    return null;
  }
}

export async function handleReferralInvoicePaid(ctx, invoice) {
  if (!ctx?.db) return;

  // Only the FIRST invoice on a fresh subscription fires the reward. Stripe
  // sets billing_reason='subscription_create' on the initial invoice and
  // ='subscription_cycle' on renewals. We also accept the absence (legacy
  // events) as long as it's the FIRST paid invoice for the referral.
  const billingReason = invoice.billing_reason;
  if (billingReason && billingReason !== 'subscription_create') return;

  // Resolve subscription → referralId. Stripe sends `invoice.subscription`
  // as a string id; we read the metadata via a follow-up fetch.
  const subscriptionId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : invoice.subscription?.id;
  if (!subscriptionId || !ctx.stripeSecretKey) return;

  let sub;
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
      headers: { Authorization: `Bearer ${ctx.stripeSecretKey}` },
    });
    if (!res.ok) return;
    sub = await res.json();
  } catch (e) {
    log.warn('billing.referralWebhooks.sub', { message: String(e?.message ?? e) });
    return;
  }

  const referralId = sub?.metadata?.referralId;
  if (!referralId) return; // Not a referral checkout.

  const referral = await dbGet(ctx, 'SELECT * FROM referrals WHERE id = ? LIMIT 1', referralId);
  if (!referral) {
    log.warn('billing.referralWebhooks', { message: 'subscription metadata names unknown referralId', referralId });
    return;
  }
  if (referral.status !== 'pending') return; // already handled (idempotency)

  const now = nowSec();
  const fingerprint = await fetchPaymentFingerprint(ctx, invoice);

  // ── Load fraud context ──────────────────────────────────────────────────
  const invitee = await dbGet(ctx,
    'SELECT id, created_at AS webUserCreatedAt, phone FROM web_users WHERE id = ?',
    referral.invitee_web_user_id,
  );
  const fingerprintMatches = fingerprint
    ? await dbAll(ctx,
        'SELECT id, status, invitee_web_user_id AS inviteeWebUserId FROM referrals WHERE invitee_payment_method_fp = ? AND id != ? AND status IN (?, ?, ?)',
        fingerprint, referralId, 'rewarded', 'first_paid', 'pending',
      )
    : [];

  // Phone collision: another web_user with the same phone that is NOT the
  // invitee and NOT the referrer.
  let phoneCollision = false;
  if (invitee?.phone) {
    const collision = await dbGet(ctx,
      'SELECT id FROM web_users WHERE phone = ? AND id != ? AND id != ? LIMIT 1',
      invitee.phone, referral.invitee_web_user_id, referral.referrer_web_user_id,
    );
    if (collision) phoneCollision = true;
  }

  const cap30d = await dbGet(ctx,
    'SELECT COUNT(*) AS n FROM referral_rewards WHERE referrer_web_user_id = ? AND status IN (?, ?) AND created_at > ?',
    referral.referrer_web_user_id, 'pending', 'applied', now - MONTH,
  );
  const cap12mo = await dbGet(ctx,
    'SELECT COUNT(*) AS n FROM referral_rewards WHERE referrer_web_user_id = ? AND status IN (?, ?) AND created_at > ?',
    referral.referrer_web_user_id, 'pending', 'applied', now - YEAR,
  );

  const fraudFlags = assessReferralFraud({
    referral: {
      referrerTenantId: referral.referrer_tenant_id,
      referrerWebUserId: referral.referrer_web_user_id,
      inviteeTenantId: referral.invitee_tenant_id,
      inviteeWebUserId: referral.invitee_web_user_id,
    },
    invitee: {
      webUserCreatedAt: invitee?.webUserCreatedAt ?? now,
      paymentFingerprint: fingerprint,
    },
    fingerprintMatches: fingerprintMatches.map((m) => ({
      id: m.id, status: m.status, inviteeWebUserId: m.inviteeWebUserId,
    })),
    referrerRewardsLast30d: Number(cap30d?.n ?? 0),
    referrerRewardsLast12mo: Number(cap12mo?.n ?? 0),
    phoneCollision,
    nowSec: now,
  });

  if (fraudFlags.length > 0) {
    await dbRun(ctx,
      `UPDATE referrals SET status = ?, first_invoice_paid_at = ?, invitee_payment_method_fp = ?, fraud_flags = ?, updated_at = ? WHERE id = ?`,
      'invalidated', now, fingerprint, JSON.stringify(fraudFlags), now, referralId,
    );
    await logReferralEvent(ctx, {
      referralId, event: 'fraud_block', metadata: { flags: fraudFlags, fingerprintPresent: Boolean(fingerprint) },
    });
    log.info('referral.invalidated', { referralId, flags: fraudFlags });
    return;
  }

  // ── Happy path: mark first_paid + issue reward ─────────────────────────
  await dbRun(ctx,
    `UPDATE referrals SET status = ?, first_invoice_paid_at = ?, invitee_payment_method_fp = ?, updated_at = ? WHERE id = ?`,
    'first_paid', now, fingerprint, now, referralId,
  );
  await logReferralEvent(ctx, { referralId, event: 'invitee_first_paid' });

  // Reward sizing — one month of the REFERRER's current plan.
  const referrerTenant = await dbGet(ctx, 'SELECT plan, stripe_customer_id FROM tenants WHERE id = ?', referral.referrer_tenant_id);
  const planKey = referrerTenant?.plan ?? 'start';
  const amountGrosz = PLAN_MONTHLY_GROSZ[planKey] ?? PLAN_MONTHLY_GROSZ.start;
  const stripeCustomerId = referrerTenant?.stripe_customer_id;
  if (!stripeCustomerId) {
    log.warn('billing.referralWebhooks', { message: 'referrer has no stripe_customer_id; skipping credit issuance', referralId });
    return;
  }

  const rewardId = crypto.randomUUID();
  const expiresAt = now + YEAR;
  await dbRun(ctx,
    `INSERT INTO referral_rewards
      (id, referrer_web_user_id, referrer_tenant_id, referral_id, kind, amount_grosz, stripe_customer_id, expires_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    rewardId, referral.referrer_web_user_id, referral.referrer_tenant_id, referralId,
    'free_month', amountGrosz, stripeCustomerId, expiresAt, 'pending', now,
  );

  let creditTxnId = null;
  try {
    const txn = await createReferralCreditPLN(ctx.stripeSecretKey, {
      customerId: stripeCustomerId,
      amountGrosz,
      description: `Referral reward — ${planKey} plan month`,
      metadata: { referralId, rewardId },
      idempotencyKey: `referral-reward-${rewardId}`,
    });
    creditTxnId = txn.id;
  } catch (e) {
    log.error('billing.referralWebhooks.credit', e instanceof Error ? e : new Error(String(e?.message)),
      { referralId, rewardId, customerId: stripeCustomerId, amountGrosz });
    // Leave reward in `pending` so a manual replay / cron retry can finish it.
    await logReferralEvent(ctx, { referralId, rewardId, event: 'credit_failed', metadata: { error: String(e?.message ?? e) } });
    return;
  }

  await dbRun(ctx,
    `UPDATE referral_rewards SET status = ?, applied_at = ?, stripe_balance_transaction = ? WHERE id = ?`,
    'applied', now, creditTxnId, rewardId,
  );
  await dbRun(ctx,
    `UPDATE referrals SET status = ?, reward_id = ?, updated_at = ? WHERE id = ?`,
    'rewarded', rewardId, now, referralId,
  );
  await logReferralEvent(ctx, {
    referralId, rewardId, event: 'reward_issued',
    metadata: { amountGrosz, plan: planKey, stripeBalanceTransaction: creditTxnId },
  });
  log.info('referral.rewarded', { referralId, rewardId, amountGrosz, plan: planKey });
}

/**
 * Clawback path: if an invitee cancels their subscription within 30 days of
 * the first paid invoice, reverse the referrer's credit.
 */
export async function handleReferralSubscriptionDeleted(ctx, sub) {
  if (!ctx?.db) return;
  const referralId = sub?.metadata?.referralId;
  if (!referralId) return;

  const referral = await dbGet(ctx, 'SELECT * FROM referrals WHERE id = ? LIMIT 1', referralId);
  if (!referral) return;
  if (referral.status !== 'rewarded' && referral.status !== 'first_paid') return;
  if (!referral.first_invoice_paid_at) return;

  const now = nowSec();
  if (now - referral.first_invoice_paid_at > CLAWBACK_WINDOW) {
    // Outside 30d window — invitee kept the discount honestly; no clawback.
    return;
  }

  await dbRun(ctx,
    `UPDATE referrals SET status = ?, updated_at = ? WHERE id = ?`,
    'clawback', now, referralId,
  );

  if (!referral.reward_id) {
    await logReferralEvent(ctx, { referralId, event: 'clawback', metadata: { note: 'no reward to reverse' } });
    return;
  }

  const reward = await dbGet(ctx, 'SELECT * FROM referral_rewards WHERE id = ? LIMIT 1', referral.reward_id);
  if (!reward) return;

  if (reward.status === 'applied' && ctx.stripeSecretKey) {
    try {
      await reverseReferralCreditPLN(ctx.stripeSecretKey, {
        customerId: reward.stripe_customer_id,
        amountGrosz: reward.amount_grosz,
        description: `Referral reward clawback — invitee cancelled within 30d`,
        metadata: { referralId, rewardId: reward.id, reason: 'clawback_within_30d' },
        idempotencyKey: `referral-reward-clawback-${reward.id}`,
      });
    } catch (e) {
      log.error('billing.referralWebhooks.clawback', e instanceof Error ? e : new Error(String(e?.message)),
        { referralId, rewardId: reward.id });
    }
  }

  await dbRun(ctx, `UPDATE referral_rewards SET status = ? WHERE id = ?`, 'clawed_back', reward.id);
  await logReferralEvent(ctx, {
    referralId, rewardId: reward.id, event: 'clawback',
    metadata: { reason: 'invitee_cancelled_within_30d', daysSinceFirstPaid: Math.floor((now - referral.first_invoice_paid_at) / DAY) },
  });
}

/**
 * Cron-driven 12-month expiry. Walks referral_rewards with status='applied'
 * AND expires_at < now, reverses the Stripe credit, marks them 'expired'.
 * Idempotent via Stripe Idempotency-Key keyed on the reward id.
 */
export async function phaseReferralExpiry(ctx) {
  if (!ctx?.db) return { processed: 0, errors: 0 };
  const now = nowSec();
  const due = await dbAll(ctx,
    'SELECT * FROM referral_rewards WHERE status = ? AND expires_at < ? LIMIT 50',
    'applied', now,
  );

  let processed = 0;
  let errors = 0;
  for (const r of due) {
    try {
      if (ctx.stripeSecretKey) {
        await reverseReferralCreditPLN(ctx.stripeSecretKey, {
          customerId: r.stripe_customer_id,
          amountGrosz: r.amount_grosz,
          description: 'Referral reward expired (12-month TTL)',
          metadata: { rewardId: r.id, reason: 'expired_12mo' },
          idempotencyKey: `referral-reward-expire-${r.id}`,
        });
      }
      await dbRun(ctx, `UPDATE referral_rewards SET status = ? WHERE id = ?`, 'expired', r.id);
      await logReferralEvent(ctx, { rewardId: r.id, event: 'reward_voided', metadata: { reason: 'expired_12mo' } });
      processed += 1;
    } catch (e) {
      log.error('billing.referralWebhooks.expiry', e instanceof Error ? e : new Error(String(e?.message)), { rewardId: r.id });
      errors += 1;
    }
  }
  return { processed, errors };
}
