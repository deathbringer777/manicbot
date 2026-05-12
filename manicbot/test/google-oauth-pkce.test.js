/**
 * P2-14 — PKCE (RFC 7636) for the Worker's Google OAuth flow.
 *
 * Verifies that:
 *   1. `generatePkceVerifier()` produces a 64-char URL-safe code_verifier.
 *   2. `deriveCodeChallengeS256()` produces the SHA-256(verifier) base64url
 *      digest expected by Google's authorization endpoint.
 *   3. The challenge can be re-derived deterministically from the verifier
 *      (the round-trip required for the callback to prove possession).
 */
import { describe, it, expect } from 'vitest';
import {
  generatePkceVerifier,
  deriveCodeChallengeS256,
} from '../src/services/google-calendar-oauth.js';

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe('PKCE primitives (P2-14)', () => {
  it('generatePkceVerifier returns a 64-character base64url string', () => {
    const v = generatePkceVerifier();
    expect(v.length).toBe(64);
    expect(v).toMatch(BASE64URL_RE);
  });

  it('generatePkceVerifier is non-deterministic', () => {
    const a = generatePkceVerifier();
    const b = generatePkceVerifier();
    expect(a).not.toBe(b);
  });

  it('deriveCodeChallengeS256 is deterministic for a given verifier', async () => {
    const v = generatePkceVerifier();
    const c1 = await deriveCodeChallengeS256(v);
    const c2 = await deriveCodeChallengeS256(v);
    expect(c1).toBe(c2);
  });

  it('deriveCodeChallengeS256 returns a 43-character base64url SHA-256 digest', async () => {
    const v = generatePkceVerifier();
    const c = await deriveCodeChallengeS256(v);
    // SHA-256 → 32 bytes → base64url no-pad → 43 chars
    expect(c.length).toBe(43);
    expect(c).toMatch(BASE64URL_RE);
  });

  it('PKCE round-trip matches the spec example (RFC 7636 §B)', async () => {
    // Spec example: verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    //               challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    const actual = await deriveCodeChallengeS256(verifier);
    expect(actual).toBe(expected);
  });

  it('a tampered verifier produces a different challenge', async () => {
    const v = generatePkceVerifier();
    const c = await deriveCodeChallengeS256(v);
    const tampered = v.slice(0, -1) + (v.endsWith('a') ? 'b' : 'a');
    const cTampered = await deriveCodeChallengeS256(tampered);
    expect(cTampered).not.toBe(c);
  });
});
