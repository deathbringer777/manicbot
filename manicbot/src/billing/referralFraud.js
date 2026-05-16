/**
 * Referral fraud assessment (PR-B).
 *
 * Pure function — no DB, no Stripe, no network. Takes the data the caller has
 * already loaded and returns a list of fraud flags. Empty list = clean.
 *
 * Fraud defenses (compensate for the user-chosen 1st-paid-invoice trigger):
 *   - duplicate_card_fingerprint   — same card fp on another rewarded/first_paid referral
 *   - self_referral_tenant         — invitee tenant == referrer tenant
 *   - self_referral_web_user       — invitee web_user_id == referrer web_user_id
 *   - phone_collision              — invitee phone matches another web_user
 *   - signup_too_recent            — invitee.created_at within last 24h of now
 *   - rate_limit_per_month         — referrer has >= 2 rewards in last 30d
 *   - annual_cap_reached           — referrer has >= 6 rewards in rolling 12mo
 *
 * Multiple flags compose: any non-empty list means the referral is
 * invalidated and the reward is NOT issued.
 */

const DAY = 24 * 3600;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * @param {object} args
 * @param {{ referrerTenantId: string, referrerWebUserId: string, inviteeTenantId: string, inviteeWebUserId: string }} args.referral
 * @param {{ webUserCreatedAt: number, paymentFingerprint: string | null }} args.invitee
 * @param {{ id: string | null, status: string, inviteeWebUserId: string }[]} args.fingerprintMatches  matches that share the same card fp on OTHER referrals
 * @param {number} args.referrerRewardsLast30d   count of pending+applied rewards for the referrer in the last 30d
 * @param {number} args.referrerRewardsLast12mo  count in rolling 365d
 * @param {boolean} args.phoneCollision          true if invitee.phone matches another web_user (not invitee, not referrer)
 * @param {number} args.nowSec
 * @returns {string[]} fraud flag list
 */
export function assessReferralFraud(args) {
  const flags = [];
  const { referral, invitee, fingerprintMatches, referrerRewardsLast30d, referrerRewardsLast12mo, phoneCollision, nowSec: now } = args;

  // 1. duplicate card fingerprint on another referral that already collected a reward (or is mid-flight)
  if (invitee.paymentFingerprint && fingerprintMatches.some((m) => m.inviteeWebUserId !== referral.inviteeWebUserId)) {
    flags.push('duplicate_card_fingerprint');
  }

  // 2. self-referral checks — defense in depth, mirror the recordRedemption pre-flight
  if (referral.referrerTenantId === referral.inviteeTenantId) flags.push('self_referral_tenant');
  if (referral.referrerWebUserId === referral.inviteeWebUserId) flags.push('self_referral_web_user');

  // 3. phone collision (caller resolves this against web_users)
  if (phoneCollision) flags.push('phone_collision');

  // 4. signup-too-recent — the invitee paid an invoice within <24h of signup.
  // Honest billing flows never look like this; the trial is 14 days and the
  // first invoice only fires after card-on-file completes the trial-ending
  // charge OR an immediate manual upgrade. Sub-24h is the throwaway-email
  // ring fingerprint.
  if (invitee.webUserCreatedAt && now - invitee.webUserCreatedAt < DAY) {
    flags.push('signup_too_recent');
  }

  // 5. per-month + annual caps. Cap-reached is NOT proof of fraud; it just
  // halts further rewards. Same flag mechanism keeps the bookkeeping
  // consistent (status=invalidated) so the referrer doesn't see a "stuck
  // forever pending" entry.
  if (referrerRewardsLast30d >= 2) flags.push('rate_limit_per_month');
  if (referrerRewardsLast12mo >= 6) flags.push('annual_cap_reached');

  return flags;
}

// Exported for tests + reuse.
export const REFERRAL_FRAUD_CONSTANTS = { DAY, MONTH, YEAR };
