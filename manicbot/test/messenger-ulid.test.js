/**
 * Worker-side ULID generator — must stay byte-compatible with the
 * admin-app `src/lib/ulid.ts` mirror so threads written from both sides
 * sort against each other identically.
 */

import { describe, it, expect } from 'vitest';
import { ulid, isUlid } from '../src/utils/ulid.js';

describe('ulid()', () => {
  it('returns a 26-char Crockford base32 string', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('orders ids monotonically over time', () => {
    const a = ulid(1700000000000);
    const b = ulid(1700000000001);
    expect(a < b).toBe(true);
  });

  it('uses Crockford base32 charset only (no I, L, O, U)', () => {
    const id = ulid();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
  });

  it('produces identical timestamp prefix at the same ms', () => {
    const t = 1700000000000;
    const a = ulid(t);
    const b = ulid(t);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10));
    expect(a.slice(10)).not.toBe(b.slice(10));
  });

  it('isUlid rejects malformed strings', () => {
    expect(isUlid('')).toBe(false);
    expect(isUlid('shorter')).toBe(false);
    expect(isUlid('a'.repeat(25))).toBe(false);
    expect(isUlid('a'.repeat(26))).toBe(false); // lowercase not in alphabet
  });
});
