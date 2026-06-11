/**
 * Regression tests for the silent-fail surface that caused /start to go silent
 * on prod after the KV→D1 bot-token migration (cb826a8 → ec85ada, 2026-05-08).
 *
 * Three holes covered here:
 *   1. Encrypted blob (no `:`) + encryptionKey = null → previously RETURNED THE
 *      BLOB AS A "TOKEN", so Telegram URL became `bot<base64>` → 401 → silence.
 *      Must now return null + emit log/event.
 *   2. Token that won't decrypt with the active key → previously swallowed in
 *      the catch and returned null silently. Must now emit log/event.
 *   3. Key rotation: blob was encrypted with BOT_ENCRYPTION_KEY_OLD, current
 *      env has new BOT_ENCRYPTION_KEY. Must transparently fall back to the old
 *      key so prod doesn't go dark mid-rotation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getBotToken, putBot } from '../src/tenant/storage.js';
import { encryptToken } from '../src/utils/security.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

const KEY_A = 'failure-modes-test-key-a-32chars-long!';
const KEY_B = 'failure-modes-test-key-b-32chars-long!';
const PLAINTEXT = '0000000000:AAfake_placeholder_token_for_tests0';
const BOT_TOKEN_LABEL = 'bot-token-v1';

function makeCtx(extra = {}) {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv, ...extra };
}

async function rawInsertBot(ctx, botId, tokenEncrypted) {
  await ctx.db
    .prepare(
      `INSERT OR REPLACE INTO bots
         (bot_id, tenant_id, webhook_secret, active, token_encrypted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(botId, 't1', 'wh-secret-1234567890ab', 1, tokenEncrypted, 1000, 1000)
    .run();
}

describe('getBotToken — encryption-key safety net', () => {
  let ctx;
  beforeEach(() => { ctx = makeCtx(); });

  it('returns null when blob is encrypted (no `:`) but encryptionKey is null — does NOT leak the blob as the "token"', async () => {
    // Pre-encrypt offline with KEY_A and shove the v1$ blob into D1, then call
    // getBotToken with encryptionKey=null (simulating BOT_ENCRYPTION_KEY unset).
    const blob = await encryptToken(PLAINTEXT, KEY_A, BOT_TOKEN_LABEL);
    expect(blob).toBeTruthy();
    expect(blob.includes(':')).toBe(false); // sanity: encrypted blob has no colon
    await rawInsertBot(ctx, 'botA', blob);

    const out = await getBotToken(ctx, 'botA', null);

    // Old buggy behaviour: returned `blob` (a v1$base64 string) as the token.
    // Correct behaviour: refuse to return an encrypted blob as plaintext.
    expect(out).toBeNull();
  });

  it('returns null when blob is encrypted but encryptionKey is too short (<32 chars)', async () => {
    const blob = await encryptToken(PLAINTEXT, KEY_A, BOT_TOKEN_LABEL);
    await rawInsertBot(ctx, 'botB', blob);

    const out = await getBotToken(ctx, 'botB', 'too-short-key');
    expect(out).toBeNull();
  });

  it('plaintext token (with `:`) passes through even when encryptionKey is null', async () => {
    // Bots in dev / pre-encryption envs may have raw `botId:secret` stored in
    // token_encrypted. That MUST keep working — it's the only escape hatch.
    await rawInsertBot(ctx, 'botC', PLAINTEXT);
    const out = await getBotToken(ctx, 'botC', null);
    expect(out).toBe(PLAINTEXT);
  });

  it('returns null AND does not throw when blob is corrupt (e.g. truncated)', async () => {
    // Random base64 that cannot decrypt under any key.
    await rawInsertBot(ctx, 'botD', 'v1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==');
    const out = await getBotToken(ctx, 'botD', KEY_A);
    expect(out).toBeNull();
  });
});

describe('getBotToken — BOT_ENCRYPTION_KEY_OLD fallback (key rotation safety)', () => {
  let ctx;
  beforeEach(() => { ctx = makeCtx({ BOT_ENCRYPTION_KEY_OLD: KEY_A }); });

  it('decrypts with BOT_ENCRYPTION_KEY_OLD when blob was encrypted with the old key and active key has rotated', async () => {
    // Encrypt with OLD key, store, then ask getBotToken to read with NEW key.
    // ctx.BOT_ENCRYPTION_KEY_OLD is set to OLD key — we expect transparent fallback.
    const blob = await encryptToken(PLAINTEXT, KEY_A, BOT_TOKEN_LABEL);
    await rawInsertBot(ctx, 'botE', blob);

    const out = await getBotToken(ctx, 'botE', KEY_B);
    expect(out).toBe(PLAINTEXT);
  });

  it('still works when only the active key matches (no fallback needed)', async () => {
    const blob = await encryptToken(PLAINTEXT, KEY_B, BOT_TOKEN_LABEL);
    await rawInsertBot(ctx, 'botF', blob);

    const out = await getBotToken(ctx, 'botF', KEY_B);
    expect(out).toBe(PLAINTEXT);
  });

  it('returns null when neither active nor old key can decrypt the blob', async () => {
    // Encrypted with a third unknown key.
    const otherKey = 'unknown-key-not-in-rotation-32chars!!';
    const blob = await encryptToken(PLAINTEXT, otherKey, BOT_TOKEN_LABEL);
    await rawInsertBot(ctx, 'botG', blob);

    const out = await getBotToken(ctx, 'botG', KEY_B);
    expect(out).toBeNull();
  });
});

describe('getBotToken — round-trip via putBot still works', () => {
  let ctx;
  beforeEach(() => { ctx = makeCtx(); });

  it('putBot then getBotToken returns the original plaintext', async () => {
    await putBot(ctx, 'botH', { tenantId: 't1', botToken: PLAINTEXT, webhookSecret: 'wh-secret-1234567890ab' }, KEY_A);
    const out = await getBotToken(ctx, 'botH', KEY_A);
    expect(out).toBe(PLAINTEXT);
  });
});
