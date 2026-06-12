/**
 * promoCodes — owner-facing SUBSCRIPTION discount codes for seasonal messaging
 * offers. One ecosystem with the existing Stripe coupon mechanics
 * (ensureCoupon/createPromotionCode in stripe.js) and the retention flow.
 *
 * DISTINCT from the tenant-level loyalty `promo_codes` table (migration 0029),
 * which is a salon→client appointment discount. Here the audience is the salon
 * OWNER and the discount is on THEIR ManicBot subscription, redeemable at
 * checkout (allow_promotion_codes is already true).
 *
 * Flow: ensureCoupon (idempotent, immutable-economics guarded) → createPromotionCode
 * (idempotent on the customer-facing code) → persist to subscription_promo_codes.
 * Persisted so a seasonal template renders {promoCode}/{expiresAt} and we never
 * re-mint a campaign's code. TEST-mode Stripe objects until go-live (livemode
 * records which). All money/codes via Stripe — D1 only stores the reference.
 */

import { dbGet, dbRun } from '../utils/db.js';
import { ulid } from '../utils/ulid.js';
import { ensureCoupon, createPromotionCode } from './stripe.js';

/** Stable coupon id for a seasonal code at a given discount (immutable economics). */
function couponIdFor(code, percentOff) {
  return `MSG_${String(code).toUpperCase()}_${percentOff}`;
}

/**
 * Look up a persisted seasonal promo by its customer-facing code.
 * @returns {Promise<object|null>}
 */
export async function getPromoByCode(ctx, code) {
  return dbGet(ctx, 'SELECT * FROM subscription_promo_codes WHERE code = ? LIMIT 1', code).catch(() => null);
}

/** Look up a persisted seasonal promo by the campaign it belongs to. */
export async function getPromoForCampaign(ctx, campaignId) {
  return dbGet(
    ctx, 'SELECT * FROM subscription_promo_codes WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1', campaignId,
  ).catch(() => null);
}

/**
 * Idempotently mint (or fetch) a seasonal subscription promo code and persist it.
 *
 * @param {object} ctx  worker ctx (db, stripeSecretKey)
 * @param {object} opts
 * @param {string}  opts.code            customer-facing code, e.g. 'WIOSNA20'
 * @param {number}  opts.percentOff      1..100
 * @param {string}  [opts.duration]      'once' | 'repeating' | 'forever' (default 'once')
 * @param {number}  [opts.durationMonths] when duration='repeating'
 * @param {number}  [opts.expiresAt]     unix seconds
 * @param {number}  [opts.maxRedemptions]
 * @param {string}  [opts.campaignId]    platform_campaigns(id) link
 * @param {string}  [opts.createdBy]
 * @returns {Promise<{data: object|null, error: string|null}>} persisted row (Result pattern)
 */
export async function mintSeasonalPromo(ctx, opts) {
  const {
    code, percentOff, duration = 'once', durationMonths = null,
    expiresAt = null, maxRedemptions = null, campaignId = null, createdBy = null,
  } = opts || {};

  if (!code || !Number.isInteger(percentOff) || percentOff < 1 || percentOff > 100) {
    return { data: null, error: 'invalid_promo_input' };
  }
  if (!ctx?.stripeSecretKey) {
    return { data: null, error: 'stripe_unconfigured' };
  }

  // Idempotent: a persisted row for this code wins (never re-mint).
  const existing = await getPromoByCode(ctx, code);
  if (existing) return { data: existing, error: null };

  const couponCode = couponIdFor(code, percentOff);
  try {
    const coupon = await ensureCoupon(ctx.stripeSecretKey, couponCode, percentOff, {
      duration, months: duration === 'repeating' ? durationMonths : undefined,
    });
    const promo = await createPromotionCode(ctx.stripeSecretKey, {
      coupon: coupon.id || couponCode,
      code,
      expiresAt,
      maxRedemptions,
    });

    const id = `spc_${ulid()}`;
    const livemode = promo.livemode ? 1 : 0;
    await dbRun(
      ctx,
      `INSERT INTO subscription_promo_codes
         (id, code, coupon_code, campaign_id, percent_off, duration, duration_months, expires_at, max_redemptions, stripe_promo_id, livemode, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, code, couponCode, campaignId, percentOff, duration, durationMonths,
      expiresAt, maxRedemptions, promo.id || null, livemode, createdBy, Math.floor(Date.now() / 1000),
    );
    const row = await getPromoByCode(ctx, code);
    return { data: row, error: null };
  } catch (e) {
    return { data: null, error: e?.message || 'promo_mint_failed' };
  }
}
