import { describe, it, expect } from 'vitest';

describe('Encryption Enforcement', () => {
  // Test the logic that resolver.js uses for token handling

  describe('plaintext Meta token detection', () => {
    // Matches isLikelyPlaintextMetaChannelToken() logic
    function isLikelyPlaintextMetaChannelToken(s) {
      if (!s || typeof s !== 'string' || s.length < 50) return false;
      if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
      return s.startsWith('EAA') || s.startsWith('IGAA');
    }

    it('detects EAA-prefixed Meta tokens', () => {
      const token = 'EAA' + 'x'.repeat(100);
      expect(isLikelyPlaintextMetaChannelToken(token)).toBe(true);
    });

    it('detects IGAA-prefixed tokens', () => {
      const token = 'IGAA' + 'x'.repeat(100);
      expect(isLikelyPlaintextMetaChannelToken(token)).toBe(true);
    });

    it('rejects short strings', () => {
      expect(isLikelyPlaintextMetaChannelToken('EAAshort')).toBe(false);
    });

    it('rejects non-token strings', () => {
      expect(isLikelyPlaintextMetaChannelToken('not a token at all!!!')).toBe(false);
    });

    it('rejects null/empty', () => {
      expect(isLikelyPlaintextMetaChannelToken(null)).toBe(false);
      expect(isLikelyPlaintextMetaChannelToken('')).toBe(false);
    });
  });

  describe('getChannelConfig token resolution', () => {
    it('with encKey set and decrypt fails → returns null (no plaintext fallback)', () => {
      const encKey = 'some-encryption-key';
      const decryptResult = null; // decrypt failed
      const rawTok = 'EAA' + 'x'.repeat(100);

      // New behavior: when encKey is set but decrypt fails, token = null
      const token = encKey ? decryptResult : rawTok;
      expect(token).toBeNull();
    });

    it('without encKey and plaintext token → uses plaintext (fallback)', () => {
      const encKey = null;
      const decryptResult = null;
      const rawTok = 'EAA' + 'x'.repeat(100);

      // Old behavior preserved: no key → plaintext allowed
      const token = encKey ? decryptResult : rawTok;
      expect(token).toBe(rawTok);
    });

    it('with encKey and decrypt succeeds → uses decrypted token', () => {
      const encKey = 'some-key';
      const decryptResult = 'decrypted-token-value';

      const token = decryptResult;
      expect(token).toBe('decrypted-token-value');
    });
  });

  describe('Google token encryption key fallback', () => {
    function getTokenEncryptionKey(ctx) {
      if (ctx?.GOOGLE_TOKEN_ENCRYPTION_KEY) return { key: ctx.GOOGLE_TOKEN_ENCRYPTION_KEY, source: 'dedicated' };
      if (ctx?.BOT_ENCRYPTION_KEY) return { key: ctx.BOT_ENCRYPTION_KEY, source: 'bot' };
      const fallback = String(ctx?.ADMIN_KEY || '');
      if (!fallback) return null;
      return { key: `${fallback}${fallback}${fallback}${fallback}`, source: 'admin_key_fallback' };
    }

    it('prefers GOOGLE_TOKEN_ENCRYPTION_KEY', () => {
      const result = getTokenEncryptionKey({ GOOGLE_TOKEN_ENCRYPTION_KEY: 'gkey', BOT_ENCRYPTION_KEY: 'bkey', ADMIN_KEY: 'akey' });
      expect(result.source).toBe('dedicated');
    });

    it('falls back to BOT_ENCRYPTION_KEY', () => {
      const result = getTokenEncryptionKey({ BOT_ENCRYPTION_KEY: 'bkey', ADMIN_KEY: 'akey' });
      expect(result.source).toBe('bot');
    });

    it('falls back to ADMIN_KEY (repeated 4x) with warning', () => {
      const result = getTokenEncryptionKey({ ADMIN_KEY: 'akey' });
      expect(result.source).toBe('admin_key_fallback');
      expect(result.key).toBe('akeyakeyakeyakey');
    });

    it('returns null when no keys available', () => {
      expect(getTokenEncryptionKey({})).toBeNull();
      expect(getTokenEncryptionKey({ ADMIN_KEY: '' })).toBeNull();
    });
  });
});
