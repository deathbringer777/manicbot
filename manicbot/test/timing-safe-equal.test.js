import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '../src/utils/security.js';

describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for different strings of different length', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns false when shorter string matches prefix of longer', () => {
    expect(timingSafeEqual('secret', 'secretXXX')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeEqual('', 'x')).toBe(false);
  });

  it('returns true for empty vs empty', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('returns false for null vs null', () => {
    // both null — not equal (safe default)
    expect(timingSafeEqual(null, null)).toBe(false);
  });

  it('returns false for null vs valid string', () => {
    expect(timingSafeEqual(null, 'abc')).toBe(false);
  });

  it('compares numbers coerced to strings', () => {
    expect(timingSafeEqual(123, 123)).toBe(true);
    expect(timingSafeEqual(123, 124)).toBe(false);
  });

  it('handles long strings correctly', () => {
    const a = 'x'.repeat(1000) + 'a';
    const b = 'x'.repeat(1000) + 'b';
    expect(timingSafeEqual(a, a)).toBe(true);
    expect(timingSafeEqual(a, b)).toBe(false);
  });
});
