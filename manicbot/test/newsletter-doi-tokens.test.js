import { describe, it, expect } from 'vitest';
import {
  generateNewsletterToken,
  isValidTokenShape,
  isConfirmTokenExpired,
  CONFIRM_TOKEN_TTL_SEC,
} from '../src/services/newsletterTokens.js';

describe('generateNewsletterToken', () => {
  it('returns 32 lowercase hex characters', () => {
    const t = generateNewsletterToken();
    expect(t).toMatch(/^[a-f0-9]{32}$/);
  });

  it('produces unique values across many calls (CSPRNG)', () => {
    const set = new Set();
    for (let i = 0; i < 200; i++) set.add(generateNewsletterToken());
    expect(set.size).toBe(200);
  });
});

describe('isValidTokenShape', () => {
  it('accepts 32-64 char lowercase hex', () => {
    expect(isValidTokenShape('a'.repeat(32))).toBe(true);
    expect(isValidTokenShape('0123456789abcdef'.repeat(2))).toBe(true);
    expect(isValidTokenShape('f'.repeat(64))).toBe(true);
  });

  it('rejects too short / too long / uppercase / non-hex / non-string', () => {
    expect(isValidTokenShape('a'.repeat(31))).toBe(false);
    expect(isValidTokenShape('a'.repeat(65))).toBe(false);
    expect(isValidTokenShape('A'.repeat(32))).toBe(false); // uppercase not allowed
    expect(isValidTokenShape('x'.repeat(32))).toBe(false); // non-hex
    expect(isValidTokenShape('')).toBe(false);
    expect(isValidTokenShape(null)).toBe(false);
    expect(isValidTokenShape(undefined)).toBe(false);
    expect(isValidTokenShape(123)).toBe(false);
    expect(isValidTokenShape('abc-def-ghi')).toBe(false); // dashes not allowed
  });
});

describe('isConfirmTokenExpired', () => {
  it('returns true when expiresAt is in the past', () => {
    const now = 1_700_000_000;
    expect(isConfirmTokenExpired(now - 1, now)).toBe(true);
    expect(isConfirmTokenExpired(now - 86_400, now)).toBe(true);
  });

  it('returns false when expiresAt is in the future', () => {
    const now = 1_700_000_000;
    expect(isConfirmTokenExpired(now + 1, now)).toBe(false);
    expect(isConfirmTokenExpired(now + CONFIRM_TOKEN_TTL_SEC, now)).toBe(false);
  });

  it('treats exact equality (expiresAt === now) as expired (inclusive boundary)', () => {
    const now = 1_700_000_000;
    expect(isConfirmTokenExpired(now, now)).toBe(true);
  });

  it('treats null/undefined expiresAt as expired (defensive)', () => {
    expect(isConfirmTokenExpired(null, 1_700_000_000)).toBe(true);
    expect(isConfirmTokenExpired(undefined, 1_700_000_000)).toBe(true);
  });
});

describe('CONFIRM_TOKEN_TTL_SEC', () => {
  it('is exactly 7 days', () => {
    expect(CONFIRM_TOKEN_TTL_SEC).toBe(7 * 24 * 60 * 60);
  });
});
