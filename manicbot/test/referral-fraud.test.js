/**
 * Unit tests for the pure-function referral fraud assessor.
 * The webhook integration test covers the wired-together flow separately.
 */
import { describe, it, expect } from 'vitest';
import { assessReferralFraud } from '../src/billing/referralFraud.js';

const REFERRAL = {
  referrerTenantId: 't_owner',
  referrerWebUserId: 'w_owner',
  inviteeTenantId: 't_invitee',
  inviteeWebUserId: 'w_invitee',
};
const NOW = 1_715_000_000;

const baseArgs = () => ({
  referral: { ...REFERRAL },
  invitee: { webUserCreatedAt: NOW - 7 * 86400, paymentFingerprint: 'fp_abc' },
  fingerprintMatches: [],
  referrerRewardsLast30d: 0,
  referrerRewardsLast12mo: 0,
  phoneCollision: false,
  nowSec: NOW,
});

describe('assessReferralFraud', () => {
  it('clean = empty flag list', () => {
    expect(assessReferralFraud(baseArgs())).toEqual([]);
  });

  it('flags duplicate card fingerprint on another referral', () => {
    const args = baseArgs();
    args.fingerprintMatches = [{ id: 'r_other', status: 'rewarded', inviteeWebUserId: 'w_other' }];
    expect(assessReferralFraud(args)).toContain('duplicate_card_fingerprint');
  });

  it('does NOT flag fingerprint match if it is the same invitee', () => {
    const args = baseArgs();
    args.fingerprintMatches = [{ id: 'r_self', status: 'pending', inviteeWebUserId: 'w_invitee' }];
    expect(assessReferralFraud(args)).not.toContain('duplicate_card_fingerprint');
  });

  it('flags self_referral_tenant', () => {
    const args = baseArgs();
    args.referral.referrerTenantId = args.referral.inviteeTenantId;
    expect(assessReferralFraud(args)).toContain('self_referral_tenant');
  });

  it('flags self_referral_web_user', () => {
    const args = baseArgs();
    args.referral.referrerWebUserId = args.referral.inviteeWebUserId;
    expect(assessReferralFraud(args)).toContain('self_referral_web_user');
  });

  it('flags phone_collision when caller resolves it', () => {
    const args = baseArgs();
    args.phoneCollision = true;
    expect(assessReferralFraud(args)).toContain('phone_collision');
  });

  it('flags signup_too_recent when invitee created < 24h before invoice', () => {
    const args = baseArgs();
    args.invitee.webUserCreatedAt = NOW - 3600; // 1h old
    expect(assessReferralFraud(args)).toContain('signup_too_recent');
  });

  it('does NOT flag signup_too_recent at exactly 24h', () => {
    const args = baseArgs();
    args.invitee.webUserCreatedAt = NOW - 86400; // exactly 24h — boundary inclusive
    // assessment uses strict < DAY, so a 24h-old signup is allowed.
    expect(assessReferralFraud(args)).not.toContain('signup_too_recent');
  });

  it('flags rate_limit_per_month at 2 rewards in last 30d', () => {
    const args = baseArgs();
    args.referrerRewardsLast30d = 2;
    expect(assessReferralFraud(args)).toContain('rate_limit_per_month');
  });

  it('flags annual_cap_reached at 6 rewards in last 365d', () => {
    const args = baseArgs();
    args.referrerRewardsLast12mo = 6;
    expect(assessReferralFraud(args)).toContain('annual_cap_reached');
  });

  it('returns multiple flags when several conditions hit', () => {
    const args = baseArgs();
    args.referral.referrerTenantId = args.referral.inviteeTenantId;
    args.invitee.webUserCreatedAt = NOW - 3600;
    args.phoneCollision = true;
    args.referrerRewardsLast12mo = 6;
    const flags = assessReferralFraud(args);
    expect(flags).toContain('self_referral_tenant');
    expect(flags).toContain('signup_too_recent');
    expect(flags).toContain('phone_collision');
    expect(flags).toContain('annual_cap_reached');
  });

  it('skips duplicate_card_fingerprint when fingerprint is null', () => {
    const args = baseArgs();
    args.invitee.paymentFingerprint = null;
    args.fingerprintMatches = [{ id: 'r_other', status: 'rewarded', inviteeWebUserId: 'w_other' }];
    expect(assessReferralFraud(args)).not.toContain('duplicate_card_fingerprint');
  });
});
