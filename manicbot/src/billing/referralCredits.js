/**
 * Stripe customer_balance credit helper for referral rewards.
 *
 * Wraps Stripe's `/customers/{id}/balance_transactions` POST with PLN-grosz
 * arithmetic and an idempotency key. The reward is posted as a NEGATIVE
 * balance transaction — Stripe applies negative balances as credits on the
 * next invoice (customer pays less or nothing until the credit is used up).
 *
 * Idempotency key shape: `referral-reward-{rewardId}` for issuance,
 * `referral-reward-expire-{rewardId}` for cron-driven voids,
 * `referral-reward-clawback-{rewardId}` for 30-day clawbacks.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function encodeForm(data) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Apply a credit (negative balance) to a Stripe Customer in PLN.
 *
 * @param {string} secretKey
 * @param {object} opts
 * @param {string} opts.customerId
 * @param {number} opts.amountGrosz       positive integer; the function will negate it
 * @param {string} opts.description
 * @param {Record<string, string>} opts.metadata
 * @param {string} opts.idempotencyKey
 * @returns {Promise<{ id: string, amount: number }>}
 */
export async function createReferralCreditPLN(secretKey, opts) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured');
  if (!opts.customerId) throw new Error('customerId is required');
  if (!Number.isInteger(opts.amountGrosz) || opts.amountGrosz <= 0) {
    throw new Error(`amountGrosz must be a positive integer (got ${opts.amountGrosz})`);
  }
  if (!opts.idempotencyKey) throw new Error('idempotencyKey is required');

  const data = {
    amount: String(-opts.amountGrosz),
    currency: 'pln',
    description: opts.description ?? 'Referral reward',
  };
  for (const [k, v] of Object.entries(opts.metadata ?? {})) {
    data[`metadata[${k}]`] = v;
  }

  const res = await fetch(`${STRIPE_API}/customers/${encodeURIComponent(opts.customerId)}/balance_transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': opts.idempotencyKey,
    },
    body: encodeForm(data),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Stripe error: ${res.status}`);
  }
  return { id: body.id, amount: body.amount };
}

/**
 * Reverse a previously-issued credit: post a POSITIVE balance transaction
 * for the SAME amount (the original was negative; positive offsets it). Used
 * by:
 *   - cron `phaseReferralExpiry` — 12-month void of unused credits
 *   - subscription.deleted clawback — invitee cancelled within 30d
 */
export async function reverseReferralCreditPLN(secretKey, opts) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured');
  if (!Number.isInteger(opts.amountGrosz) || opts.amountGrosz <= 0) {
    throw new Error(`amountGrosz must be positive integer for reversal`);
  }
  if (!opts.idempotencyKey) throw new Error('idempotencyKey is required');

  const data = {
    amount: String(opts.amountGrosz),
    currency: 'pln',
    description: opts.description ?? 'Referral reward reversal',
  };
  for (const [k, v] of Object.entries(opts.metadata ?? {})) {
    data[`metadata[${k}]`] = v;
  }

  const res = await fetch(`${STRIPE_API}/customers/${encodeURIComponent(opts.customerId)}/balance_transactions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': opts.idempotencyKey,
    },
    body: encodeForm(data),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Stripe error: ${res.status}`);
  }
  return { id: body.id, amount: body.amount };
}

/**
 * Per-plan monthly price in PLN grosz. Authoritative for reward amount sizing.
 */
export const PLAN_MONTHLY_GROSZ = {
  start: 4500,
  pro: 6000,
  max: 9000,
};
