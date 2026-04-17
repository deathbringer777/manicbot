import { describe, it, expect } from 'vitest';
import {
  encryptToken, decryptToken, deriveSubkey, deriveHmacSubkey,
} from '../src/utils/security.js';

const MASTER_KEY = 'a'.repeat(64); // 64 hex chars

describe('#S6 — HKDF subkey derivation (security.js)', () => {
  it('encrypts and decrypts round-trip with same label', async () => {
    const ct = await encryptToken('secret-bot-token', MASTER_KEY, 'channel-token-v1');
    expect(ct).toMatch(/^v1\$/);
    const pt = await decryptToken(ct, MASTER_KEY, 'channel-token-v1');
    expect(pt).toBe('secret-bot-token');
  });

  it('decryption with WRONG label fails (returns null) — domain separation', async () => {
    const ct = await encryptToken('tg-token-here', MASTER_KEY, 'channel-token-v1');
    const wrongLabel = await decryptToken(ct, MASTER_KEY, 'google-refresh-v1');
    expect(wrongLabel).toBeNull();
  });

  it('decryption WITHOUT label fails on v1 ciphertext (refuses silent fallback)', async () => {
    const ct = await encryptToken('tg-token-here', MASTER_KEY, 'channel-token-v1');
    const noLabel = await decryptToken(ct, MASTER_KEY);
    expect(noLabel).toBeNull();
  });

  it('legacy ciphertext (no v1$ prefix) still decrypts WITHOUT label — back-compat', async () => {
    // Synthesize a legacy ciphertext by encrypting WITHOUT a label.
    const legacyCt = await encryptToken('legacy-token', MASTER_KEY); // no label
    expect(legacyCt).not.toMatch(/^v1\$/);
    const pt = await decryptToken(legacyCt, MASTER_KEY); // no label needed
    expect(pt).toBe('legacy-token');
  });

  it('three different labels produce three distinct ciphertexts of same plaintext', async () => {
    const labels = ['channel-token-v1', 'google-refresh-v1', 'bot-token-v1'];
    const cts = await Promise.all(labels.map(l => encryptToken('same-secret', MASTER_KEY, l)));
    // All start with v1$ but the rest must differ (different keys → different IV+ciphertext)
    const stripped = cts.map(c => c.slice(3));
    expect(new Set(stripped).size).toBe(3);
    // Each can only decrypt with its own label
    for (let i = 0; i < labels.length; i++) {
      expect(await decryptToken(cts[i], MASTER_KEY, labels[i])).toBe('same-secret');
      for (let j = 0; j < labels.length; j++) {
        if (i === j) continue;
        expect(await decryptToken(cts[i], MASTER_KEY, labels[j])).toBeNull();
      }
    }
  });

  it('deriveSubkey produces stable AES-GCM CryptoKey', async () => {
    const k1 = await deriveSubkey(MASTER_KEY, 'channel-token-v1');
    const k2 = await deriveSubkey(MASTER_KEY, 'channel-token-v1');
    // Re-importing the bits should produce keys that encrypt the same data the same way
    const iv = new Uint8Array(12); // zero IV just for determinism check
    const enc = new TextEncoder().encode('test');
    const c1 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k1, enc);
    const c2 = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, enc);
    expect(new Uint8Array(c1)).toEqual(new Uint8Array(c2));
  });

  it('deriveSubkey throws on missing/short master key', async () => {
    await expect(deriveSubkey('', 'label')).rejects.toThrow();
    await expect(deriveSubkey('x'.repeat(31), 'label')).rejects.toThrow();
  });

  it('deriveSubkey throws on missing label', async () => {
    await expect(deriveSubkey(MASTER_KEY, '')).rejects.toThrow();
    await expect(deriveSubkey(MASTER_KEY, undefined)).rejects.toThrow();
  });

  it('deriveHmacSubkey signs and verifies', async () => {
    const k = await deriveHmacSubkey(MASTER_KEY, 'calendar-hmac-v1');
    const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('apt_123:1700000000'));
    const ok = await crypto.subtle.verify('HMAC', k, sig, new TextEncoder().encode('apt_123:1700000000'));
    expect(ok).toBe(true);
  });

  it('encryption refuses short master key', async () => {
    expect(await encryptToken('x', 'short', 'label')).toBeNull();
    expect(await encryptToken('x', '', 'label')).toBeNull();
  });
});
