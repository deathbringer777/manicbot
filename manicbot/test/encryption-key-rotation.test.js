/**
 * #P1-5 — decryptTokenWithFallback enables transparent rotation of
 * BOT_ENCRYPTION_KEY. During the rotation window, callers read with the
 * new key and fall back to the old one; the operator runs the admin
 * sweep until every blob has been re-encrypted under the new key.
 */
import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, decryptTokenWithFallback } from '../src/utils/security.js';

const KEY_A = 'a'.repeat(48);
const KEY_B = 'b'.repeat(48);
const LABEL = 'channel-token-v1';

describe('decryptTokenWithFallback (#P1-5)', () => {
  it('returns plain + usedOldKey:false when the active key works', async () => {
    const enc = await encryptToken('plaintext-token', KEY_A, LABEL);
    const r = await decryptTokenWithFallback(enc, KEY_A, KEY_B, LABEL);
    expect(r.plain).toBe('plaintext-token');
    expect(r.usedOldKey).toBe(false);
  });

  it('falls back to the old key when the active key fails', async () => {
    // Blob was encrypted with KEY_A but the active key is now KEY_B.
    const enc = await encryptToken('legacy', KEY_A, LABEL);
    const r = await decryptTokenWithFallback(enc, /* primary */ KEY_B, /* old */ KEY_A, LABEL);
    expect(r.plain).toBe('legacy');
    expect(r.usedOldKey).toBe(true);
  });

  it('returns null/false when neither key works', async () => {
    const enc = await encryptToken('lost', KEY_A, LABEL);
    const r = await decryptTokenWithFallback(enc, KEY_B, 'c'.repeat(48), LABEL);
    expect(r.plain).toBeNull();
    expect(r.usedOldKey).toBe(false);
  });

  it('skips fallback when no old key supplied', async () => {
    const enc = await encryptToken('hello', KEY_A, LABEL);
    const r = await decryptTokenWithFallback(enc, KEY_B, null, LABEL);
    expect(r.plain).toBeNull();
    expect(r.usedOldKey).toBe(false);
  });

  it('skips fallback when old key equals primary (no rotation)', async () => {
    const enc = await encryptToken('hello', KEY_A, LABEL);
    const r = await decryptTokenWithFallback(enc, KEY_B, KEY_B, LABEL);
    expect(r.plain).toBeNull();
    expect(r.usedOldKey).toBe(false);
  });

  it('after rotation, blobs re-encrypted with KEY_B decrypt with KEY_B alone', async () => {
    // Simulate the operator flow: read-with-fallback → re-encrypt with new
    // key. After the sweep, every blob is on KEY_B and KEY_A can be removed.
    const oldEnc = await encryptToken('rotate-me', KEY_A, LABEL);
    const { plain } = await decryptTokenWithFallback(oldEnc, KEY_B, KEY_A, LABEL);
    expect(plain).toBe('rotate-me');
    const newEnc = await encryptToken(plain, KEY_B, LABEL);
    // Once rotated, decryption needs only the new key.
    const direct = await decryptToken(newEnc, KEY_B, LABEL);
    expect(direct).toBe('rotate-me');
  });
});
