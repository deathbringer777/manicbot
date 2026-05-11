/**
 * P1-8 — channel-token plaintext fallback was removed. The Meta token
 * decryption path in `getChannelConfig` (and friends in `token-manager.js`)
 * must fail closed when BOT_ENCRYPTION_KEY is missing rather than passing
 * through the plaintext value stored in `token_encrypted`.
 *
 * Pre-fix: a forgotten BOT_ENCRYPTION_KEY allowed plaintext tokens to be
 * sent outbound to Meta on every webhook reply.
 */
import { describe, it, expect } from 'vitest';
import { getChannelConfig } from '../src/channels/resolver.js';
import { encryptAndStoreToken, getDecryptedToken } from '../src/channels/token-manager.js';
import { encryptToken } from '../src/utils/security.js';

function dbWithRows(rows) {
  return {
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: rows }),
      }),
    }),
  };
}

describe('getChannelConfig — P1-8 fail-closed', () => {
  it('returns token=null when BOT_ENCRYPTION_KEY is missing, even with a plaintext-looking token', async () => {
    const ctx = {
      db: dbWithRows([{
        id: 'cfg_1',
        tenant_id: 't_demo',
        channel_type: 'instagram',
        active: 1,
        // Looks like a Meta long-lived token (EAA prefix) — pre-fix this
        // would be passed through.
        token_encrypted: 'EAA' + 'a'.repeat(60),
        config: '{}',
      }]),
    };
    const result = await getChannelConfig(ctx, 't_demo', 'instagram', null);
    expect(result).not.toBeNull();
    expect(result.token).toBeNull();
  });

  it('returns the decrypted token when key is set and ciphertext is valid', async () => {
    const key = 'k'.repeat(64);
    const plaintext = 'EAA' + 'real-token-value-' + 'x'.repeat(30);
    const encrypted = await encryptToken(plaintext, key, 'channel-token-v1');

    const ctx = {
      db: dbWithRows([{
        id: 'cfg_1',
        tenant_id: 't_demo',
        channel_type: 'instagram',
        active: 1,
        token_encrypted: encrypted,
        config: '{}',
      }]),
    };
    const result = await getChannelConfig(ctx, 't_demo', 'instagram', key);
    expect(result.token).toBe(plaintext);
  });

  it('returns token=null on decrypt failure (e.g. key rotated without re-encrypt)', async () => {
    const key1 = 'k'.repeat(64);
    const key2 = 'q'.repeat(64);
    const encrypted = await encryptToken('whatever-secret-token-value', key1, 'channel-token-v1');
    const ctx = {
      db: dbWithRows([{
        id: 'cfg_1',
        tenant_id: 't_demo',
        channel_type: 'instagram',
        active: 1,
        token_encrypted: encrypted,
        config: '{}',
      }]),
    };
    const result = await getChannelConfig(ctx, 't_demo', 'instagram', key2);
    expect(result.token).toBeNull();
  });
});

describe('token-manager — P1-8 fail-closed', () => {
  function mutableDb() {
    const rows = [];
    return {
      rows,
      prepare(_sql) {
        return {
          bind(...binds) {
            return {
              all: async () => ({ results: rows.filter(r => r.id === binds[binds.length - 1]) }),
              run: async () => {
                // Toy implementation: we don't really run UPDATEs in this test —
                // encryptAndStoreToken is verified by its return value.
                return { meta: {} };
              },
            };
          },
        };
      },
    };
  }

  it('encryptAndStoreToken refuses to write when encKey is missing', async () => {
    const ctx = { db: mutableDb() };
    const ok = await encryptAndStoreToken(ctx, 'cfg_1', 'plaintext-fake-token', null);
    expect(ok).toBe(false);
  });

  it('encryptAndStoreToken refuses to write when encKey is too short', async () => {
    const ctx = { db: mutableDb() };
    const ok = await encryptAndStoreToken(ctx, 'cfg_1', 'plaintext-fake-token', 'short');
    expect(ok).toBe(false);
  });

  it('getDecryptedToken returns null when encKey is missing', async () => {
    const dbStub = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ token_encrypted: 'EAA' + 'x'.repeat(60) }] }),
        }),
      }),
    };
    const token = await getDecryptedToken({ db: dbStub }, 'cfg_1', null);
    expect(token).toBeNull();
  });
});
