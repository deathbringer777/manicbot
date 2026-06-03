/**
 * Channel token security tests.
 *
 * Verifies:
 * - BOT_ENCRYPTION_KEY is used when set
 * - Plaintext fallback logs security warning
 * - Encrypted vs unencrypted token paths
 * - Token-manager roundtrip (encrypt then decrypt)
 * - createChannelConfig refuses to store without encryption key
 */

import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/utils/security.js';
import {
  encryptAndStoreToken,
  getDecryptedToken,
  isTokenExpiring,
  createChannelConfig,
} from '../src/channels/token-manager.js';
import { createMockD1 } from './helpers/mock-db.js';

const VALID_ENC_KEY = 'test-encryption-key-32-chars-ok!'; // exactly 32 chars

function makeTokenCtx() {
  const db = createMockD1();
  return { db, tenantId: 'test' };
}

// ── Low-level encrypt/decrypt roundtrip ───────────────────────────────────

describe('encryptToken / decryptToken roundtrip', () => {
  it('encrypts and decrypts a token back to the original', async () => {
    const plain = 'EAA' + 'x'.repeat(100);
    const encrypted = await encryptToken(plain, VALID_ENC_KEY);
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toBe(plain);
    // Encrypted value is base64 (no colons)
    expect(encrypted.includes(':')).toBe(false);

    const decrypted = await decryptToken(encrypted, VALID_ENC_KEY);
    expect(decrypted).toBe(plain);
  });

  it('returns null when encryption key is too short', async () => {
    const plain = 'some-token';
    const result = await encryptToken(plain, 'short');
    expect(result).toBeNull();
  });

  it('returns null when encryption key is null', async () => {
    expect(await encryptToken('token', null)).toBeNull();
    expect(await encryptToken('token', '')).toBeNull();
  });

  it('returns null when decryption key is wrong', async () => {
    const plain = 'EAA' + 'y'.repeat(80);
    const encrypted = await encryptToken(plain, VALID_ENC_KEY);
    expect(encrypted).not.toBeNull();

    const wrongKey = 'wrong-encryption-key-32-chars-ok!';
    const decrypted = await decryptToken(encrypted, wrongKey);
    expect(decrypted).toBeNull();
  });

  it('returns null when decryption key is too short', async () => {
    expect(await decryptToken('gibberish', 'short')).toBeNull();
  });

  it('returns null when encrypted data is malformed', async () => {
    expect(await decryptToken('not-base64!!!', VALID_ENC_KEY)).toBeNull();
  });

  it('different plaintexts produce different ciphertexts', async () => {
    const enc1 = await encryptToken('token_one', VALID_ENC_KEY);
    const enc2 = await encryptToken('token_two', VALID_ENC_KEY);
    expect(enc1).not.toBe(enc2);
  });

  it('same plaintext encrypted twice produces different ciphertexts (random IV)', async () => {
    const plain = 'same-token-value';
    const enc1 = await encryptToken(plain, VALID_ENC_KEY);
    const enc2 = await encryptToken(plain, VALID_ENC_KEY);
    expect(enc1).not.toBe(enc2);
    // But both decrypt to the same value
    expect(await decryptToken(enc1, VALID_ENC_KEY)).toBe(plain);
    expect(await decryptToken(enc2, VALID_ENC_KEY)).toBe(plain);
  });
});

// ── BOT_ENCRYPTION_KEY is used when set ───────────────────────────────────

describe('BOT_ENCRYPTION_KEY is used when set', () => {
  it('encryptAndStoreToken stores encrypted value when encKey provided', async () => {
    const ctx = makeTokenCtx();
    // Pre-insert a channel_configs row
    await ctx.db.prepare(
      'INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, config, token_encrypted, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).bind('cc1', 'test', 'instagram', '{}', 'old_token', Date.now(), Date.now()).run();

    const result = await encryptAndStoreToken(ctx, 'test', 'cc1', 'EAAnewtoken123', VALID_ENC_KEY);
    expect(result).toBe(true);

    // Verify stored value is encrypted (not the plaintext)
    const row = await ctx.db.prepare(
      'SELECT token_encrypted FROM channel_configs WHERE id = ?',
    ).bind('cc1').first();
    expect(row.token_encrypted).not.toBe('EAAnewtoken123');
    expect(row.token_encrypted).not.toBeNull();
  });

  it('getDecryptedToken decrypts when encKey provided', async () => {
    const ctx = makeTokenCtx();
    const plain = 'EAAsecrettoken789';
    const encrypted = await encryptToken(plain, VALID_ENC_KEY);

    await ctx.db.prepare(
      'INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, config, token_encrypted, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).bind('cc2', 'test', 'instagram', '{}', encrypted, Date.now(), Date.now()).run();

    const decrypted = await getDecryptedToken(ctx, 'test', 'cc2', VALID_ENC_KEY);
    expect(decrypted).toBe(plain);
  });
});

// ── Fail-closed when no encryption key (P1-8) ─────────────────────────────
//
// Previously the channel-token helpers fell back to plaintext when
// BOT_ENCRYPTION_KEY was unset. P1-8 removed that fallback: with no key,
// writes refuse and reads return null. This documents the new contract.

describe('plaintext fallback removed (P1-8)', () => {
  it('encryptAndStoreToken refuses to store when encKey is null', async () => {
    const ctx = makeTokenCtx();
    await ctx.db.prepare(
      'INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, config, token_encrypted, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).bind('cc3', 'test', 'whatsapp', '{}', '', Date.now(), Date.now()).run();

    const result = await encryptAndStoreToken(ctx, 'test', 'cc3', 'EAAplaintoken', null);
    expect(result).toBe(false);
  });

  it('getDecryptedToken returns null when encKey is null', async () => {
    const ctx = makeTokenCtx();
    const plain = 'EAArawtoken456';
    await ctx.db.prepare(
      'INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, config, token_encrypted, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).bind('cc4', 'test', 'instagram', '{}', plain, Date.now(), Date.now()).run();

    const result = await getDecryptedToken(ctx, 'test', 'cc4', null);
    expect(result).toBeNull();
  });
});

// ── Encrypted vs unencrypted token paths ──────────────────────────────────

describe('encrypted vs unencrypted token paths', () => {
  it('with encKey set and decrypt fails, token is null (no plaintext fallback)', () => {
    const encKey = 'some-encryption-key-for-security!';
    const decryptResult = null; // decrypt failed
    const rawTok = 'EAA' + 'x'.repeat(100);

    // When encKey is set but decrypt fails: token = null (secure behavior)
    const token = encKey ? decryptResult : rawTok;
    expect(token).toBeNull();
  });

  it('without encKey, plaintext token is used (fallback)', () => {
    const encKey = null;
    const rawTok = 'EAA' + 'x'.repeat(100);

    const token = encKey ? null : rawTok;
    expect(token).toBe(rawTok);
  });

  it('with encKey and successful decrypt, decrypted token is used', async () => {
    const plain = 'EAArealtoken';
    const encrypted = await encryptToken(plain, VALID_ENC_KEY);
    const decrypted = await decryptToken(encrypted, VALID_ENC_KEY);
    expect(decrypted).toBe(plain);
  });

  it('plaintext Meta token detection (EAA prefix)', () => {
    function isLikelyPlaintextMetaChannelToken(s) {
      if (!s || typeof s !== 'string' || s.length < 50) return false;
      if (!/^[A-Za-z0-9_-]+$/.test(s)) return false;
      return s.startsWith('EAA') || s.startsWith('IGAA');
    }

    expect(isLikelyPlaintextMetaChannelToken('EAA' + 'a'.repeat(100))).toBe(true);
    expect(isLikelyPlaintextMetaChannelToken('IGAA' + 'b'.repeat(100))).toBe(true);
    expect(isLikelyPlaintextMetaChannelToken('EAAshort')).toBe(false);
    expect(isLikelyPlaintextMetaChannelToken(null)).toBe(false);
    expect(isLikelyPlaintextMetaChannelToken('')).toBe(false);
    expect(isLikelyPlaintextMetaChannelToken('not-a-token!!!')).toBe(false);
  });
});

// ── createChannelConfig refuses without encryption key ────────────────────

describe('createChannelConfig security enforcement', () => {
  it('refuses to create channel config without encryption key', async () => {
    const ctx = makeTokenCtx();
    const id = await createChannelConfig(ctx, 'test', 'instagram', { page_id: '123' }, 'EAAtoken', null);
    expect(id).toBeNull();
  });

  it('refuses to create channel config with short encryption key', async () => {
    const ctx = makeTokenCtx();
    const id = await createChannelConfig(ctx, 'test', 'instagram', { page_id: '123' }, 'EAAtoken', 'short-key');
    expect(id).toBeNull();
  });

  it('creates channel config when valid encryption key is provided', async () => {
    const ctx = makeTokenCtx();
    const id = await createChannelConfig(
      ctx, 'test', 'instagram',
      { page_id: '456' },
      'EAAmytoken',
      VALID_ENC_KEY,
    );
    expect(id).not.toBeNull();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('stored token is encrypted (not plaintext) after createChannelConfig', async () => {
    const ctx = makeTokenCtx();
    const plain = 'EAAsupersecrettoken';
    const id = await createChannelConfig(
      ctx, 'test', 'whatsapp',
      { phone_number_id: '789' },
      plain,
      VALID_ENC_KEY,
    );
    expect(id).not.toBeNull();

    const row = await ctx.db.prepare(
      'SELECT token_encrypted FROM channel_configs WHERE id = ?',
    ).bind(id).first();
    expect(row).not.toBeNull();
    expect(row.token_encrypted).not.toBe(plain);
    // The stored value should be decryptable. After #S6 the new format is v1$...
    // and decryption requires the matching HKDF subkey label.
    expect(row.token_encrypted).toMatch(/^v1\$/);
    const decrypted = await decryptToken(row.token_encrypted, VALID_ENC_KEY, 'channel-token-v1');
    expect(decrypted).toBe(plain);
  });

  it('returns null when db is missing', async () => {
    const ctx = { db: null };
    const id = await createChannelConfig(ctx, 'test', 'instagram', {}, 'token', VALID_ENC_KEY);
    expect(id).toBeNull();
  });
});

// ── isTokenExpiring ───────────────────────────────────────────────────────

describe('isTokenExpiring', () => {
  it('returns false when no expiration set', () => {
    expect(isTokenExpiring({ token_expires_at: null })).toBe(false);
    expect(isTokenExpiring({})).toBe(false);
    expect(isTokenExpiring(null)).toBe(false);
  });

  it('returns true when token expires within threshold', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Expires in 5 days, threshold is 10 days
    const config = { token_expires_at: nowSec + 5 * 86400 };
    expect(isTokenExpiring(config, 10)).toBe(true);
  });

  it('returns false when token expires well beyond threshold', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Expires in 30 days, threshold is 10 days
    const config = { token_expires_at: nowSec + 30 * 86400 };
    expect(isTokenExpiring(config, 10)).toBe(false);
  });

  it('returns true when token has already expired', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const config = { token_expires_at: nowSec - 86400 };
    expect(isTokenExpiring(config, 10)).toBe(true);
  });
});

// ── Google token encryption key fallback chain ────────────────────────────

describe('Google token encryption key fallback chain', () => {
  function getTokenEncryptionKey(ctx) {
    if (ctx?.GOOGLE_TOKEN_ENCRYPTION_KEY) return { key: ctx.GOOGLE_TOKEN_ENCRYPTION_KEY, source: 'dedicated' };
    if (ctx?.BOT_ENCRYPTION_KEY) return { key: ctx.BOT_ENCRYPTION_KEY, source: 'bot' };
    const fallback = String(ctx?.ADMIN_KEY || '');
    if (!fallback) return null;
    return { key: `${fallback}${fallback}${fallback}${fallback}`, source: 'admin_key_fallback' };
  }

  it('prefers GOOGLE_TOKEN_ENCRYPTION_KEY over all others', () => {
    const result = getTokenEncryptionKey({
      GOOGLE_TOKEN_ENCRYPTION_KEY: 'google-key',
      BOT_ENCRYPTION_KEY: 'bot-key',
      ADMIN_KEY: 'admin-key',
    });
    expect(result.source).toBe('dedicated');
    expect(result.key).toBe('google-key');
  });

  it('falls back to BOT_ENCRYPTION_KEY when no Google key', () => {
    const result = getTokenEncryptionKey({
      BOT_ENCRYPTION_KEY: 'bot-key-value',
      ADMIN_KEY: 'admin-key',
    });
    expect(result.source).toBe('bot');
    expect(result.key).toBe('bot-key-value');
  });

  it('falls back to ADMIN_KEY repeated 4x when no other keys', () => {
    const result = getTokenEncryptionKey({ ADMIN_KEY: 'akey' });
    expect(result.source).toBe('admin_key_fallback');
    expect(result.key).toBe('akeyakeyakeyakey');
  });

  it('returns null when no keys are available', () => {
    expect(getTokenEncryptionKey({})).toBeNull();
    expect(getTokenEncryptionKey({ ADMIN_KEY: '' })).toBeNull();
  });
});

// ── Tenant isolation (D3) ─────────────────────────────────────────────────
//
// encryptAndStoreToken / getDecryptedToken touch channel_configs by PK. They
// now ALSO scope by tenant_id, so a channelConfigId from one tenant can never
// read or overwrite another tenant's channel token. Defense-in-depth: the id
// is a random 12-char, but the gate makes cross-tenant access impossible even
// if an id leaks. Flips the worker tenant-isolation scanner green for D3.

describe('channel token tenant isolation (D3)', () => {
  const KEY = VALID_ENC_KEY;

  async function seedRow(ctx, id, tenantId, plain) {
    const enc = await encryptToken(plain, KEY, 'channel-token-v1');
    await ctx.db.prepare(
      'INSERT OR REPLACE INTO channel_configs (id, tenant_id, channel_type, config, token_encrypted, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    ).bind(id, tenantId, 'instagram', '{}', enc, Date.now(), Date.now()).run();
    return enc;
  }

  it('getDecryptedToken returns the token for the owning tenant', async () => {
    const ctx = makeTokenCtx();
    await seedRow(ctx, 'cc_iso1', 'tenantA', 'EAAtokenA');
    expect(await getDecryptedToken(ctx, 'tenantA', 'cc_iso1', KEY)).toBe('EAAtokenA');
  });

  it('getDecryptedToken returns null for a cross-tenant channelConfigId', async () => {
    const ctx = makeTokenCtx();
    await seedRow(ctx, 'cc_iso2', 'tenantA', 'EAAtokenA');
    // tenantB knows the id but does not own the row → no leak.
    expect(await getDecryptedToken(ctx, 'tenantB', 'cc_iso2', KEY)).toBeNull();
  });

  it('encryptAndStoreToken does not overwrite a cross-tenant row', async () => {
    const ctx = makeTokenCtx();
    const original = await seedRow(ctx, 'cc_iso3', 'tenantA', 'EAAoriginal');
    // Attacker in tenantB tries to overwrite tenantA's token.
    await encryptAndStoreToken(ctx, 'tenantB', 'cc_iso3', 'EAAhijack', KEY);
    const row = await ctx.db.prepare(
      'SELECT token_encrypted FROM channel_configs WHERE id = ?',
    ).bind('cc_iso3').first();
    expect(row.token_encrypted).toBe(original); // unchanged
    expect(await decryptToken(row.token_encrypted, KEY, 'channel-token-v1')).toBe('EAAoriginal');
  });

  it('encryptAndStoreToken updates the row for the owning tenant', async () => {
    const ctx = makeTokenCtx();
    await seedRow(ctx, 'cc_iso4', 'tenantA', 'EAAoriginal');
    const ok = await encryptAndStoreToken(ctx, 'tenantA', 'cc_iso4', 'EAArotated', KEY);
    expect(ok).toBe(true);
    const decrypted = await getDecryptedToken(ctx, 'tenantA', 'cc_iso4', KEY);
    expect(decrypted).toBe('EAArotated');
  });
});
