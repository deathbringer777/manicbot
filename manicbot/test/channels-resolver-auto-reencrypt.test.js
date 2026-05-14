/**
 * Tests for getChannelConfig's auto re-encrypt path. Background: a key
 * rotation that doesn't run the re-encrypt sweep leaves channel_configs
 * blobs unreadable. The resolver now accepts BOT_ENCRYPTION_KEY_OLD as
 * a fallback and, on a successful old-key decrypt, re-wraps the blob
 * with the new key in place so future reads don't pay the fallback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  decryptTokenWithFallback: vi.fn(),
  encryptToken: vi.fn(async (plain) => `v1$NEW:${plain}`),
  dbRun: vi.fn(async () => ({ success: true })),
}));
const { decryptToken, decryptTokenWithFallback, encryptToken, dbRun } = mocks;

vi.mock('../src/utils/security.js', () => ({
  decryptToken: mocks.decryptToken,
  decryptTokenWithFallback: mocks.decryptTokenWithFallback,
  encryptToken: mocks.encryptToken,
}));
vi.mock('../src/utils/db.js', async () => {
  const actual = await vi.importActual('../src/utils/db.js');
  return { ...actual, dbRun: mocks.dbRun };
});

import { getChannelConfig } from '../src/channels/resolver.js';

const NEW_KEY = 'n'.repeat(32);
const OLD_KEY = 'o'.repeat(32);

function makeCtx({ row }) {
  return {
    db: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() { return null; },
          async all() {
            if (sql.includes('FROM channel_configs')) return { results: row ? [row] : [] };
            return { results: [] };
          },
          async run() { return { success: true }; },
        };
      },
    },
  };
}

describe('getChannelConfig — auto re-encrypt on old-key decrypt', () => {
  beforeEach(() => {
    decryptToken.mockReset();
    decryptTokenWithFallback.mockReset();
    encryptToken.mockClear();
    dbRun.mockClear();
  });

  it('returns null when no channel row', async () => {
    const ctx = makeCtx({ row: null });
    const res = await getChannelConfig(ctx, 't_1', 'instagram', NEW_KEY);
    expect(res).toBeNull();
  });

  it('uses primary key only when no old key supplied — no re-encrypt', async () => {
    decryptToken.mockResolvedValueOnce('plain-token');
    const ctx = makeCtx({
      row: { id: 1, token_encrypted: 'v1$NEW:plain-token', config: '{}' },
    });
    const res = await getChannelConfig(ctx, 't_1', 'instagram', NEW_KEY);
    expect(res.token).toBe('plain-token');
    expect(encryptToken).not.toHaveBeenCalled();
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('falls back to old key and re-encrypts when primary key fails', async () => {
    decryptTokenWithFallback.mockResolvedValueOnce({
      plain: 'recovered-token', usedOldKey: true,
    });
    const ctx = makeCtx({
      row: { id: 42, token_encrypted: 'v1$OLD:recovered-token', config: '{}' },
    });
    const res = await getChannelConfig(ctx, 't_1', 'instagram', NEW_KEY, OLD_KEY);
    expect(res.token).toBe('recovered-token');

    // Old key actually used.
    expect(decryptTokenWithFallback).toHaveBeenCalledWith(
      'v1$OLD:recovered-token', NEW_KEY, OLD_KEY, 'channel-token-v1',
    );
    // Re-encrypt fired with the new key.
    expect(encryptToken).toHaveBeenCalledWith('recovered-token', NEW_KEY, 'channel-token-v1');
    // Persisted back to D1.
    expect(dbRun).toHaveBeenCalled();
    const sql = dbRun.mock.calls[0][1];
    expect(sql).toContain('UPDATE channel_configs');
    expect(sql).toContain('token_encrypted');
  });

  it('skips re-encrypt when primary key worked via fallback', async () => {
    decryptTokenWithFallback.mockResolvedValueOnce({
      plain: 'recovered-token', usedOldKey: false,
    });
    const ctx = makeCtx({
      row: { id: 1, token_encrypted: 'v1$NEW:recovered-token', config: '{}' },
    });
    await getChannelConfig(ctx, 't_1', 'instagram', NEW_KEY, OLD_KEY);
    // Decrypt succeeded with primary — no rewrap needed.
    expect(encryptToken).not.toHaveBeenCalled();
    expect(dbRun).not.toHaveBeenCalled();
  });

  it('still returns the plaintext token even if re-encrypt write fails', async () => {
    decryptTokenWithFallback.mockResolvedValueOnce({
      plain: 'recovered-token', usedOldKey: true,
    });
    dbRun.mockRejectedValueOnce(new Error('D1 hiccup'));
    const ctx = makeCtx({
      row: { id: 1, token_encrypted: 'v1$OLD:recovered-token', config: '{}' },
    });
    const res = await getChannelConfig(ctx, 't_1', 'instagram', NEW_KEY, OLD_KEY);
    expect(res.token).toBe('recovered-token');
  });

  it('reads BOT_ENCRYPTION_KEY_OLD from ctx when oldKey arg not passed', async () => {
    decryptTokenWithFallback.mockResolvedValueOnce({
      plain: 'recovered-token', usedOldKey: true,
    });
    const ctx = makeCtx({
      row: { id: 1, token_encrypted: 'v1$OLD:recovered-token', config: '{}' },
    });
    ctx.BOT_ENCRYPTION_KEY_OLD = OLD_KEY;
    await getChannelConfig(ctx, 't_1', 'instagram', NEW_KEY);
    expect(decryptTokenWithFallback).toHaveBeenCalledWith(
      'v1$OLD:recovered-token', NEW_KEY, OLD_KEY, 'channel-token-v1',
    );
  });
});
