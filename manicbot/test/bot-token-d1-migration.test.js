/**
 * Tests for KV → D1 bot token migration.
 *
 * getBotToken should read D1 bots.token_encrypted first and only fall back
 * to KV when the D1 row has no token (i.e. the bot hasn't been migrated yet).
 *
 * putBot should write token_encrypted into the D1 bots row in addition to
 * the belt-and-suspenders KV write.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getBotToken, putBot } from '../src/tenant/storage.js';
import { encryptToken } from '../src/utils/security.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

const ENC_KEY = 'test-encryption-key-32-bytes-long!!';
const BOT_TOKEN_LABEL = 'bot-token-v1';

function makeCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv };
}

// ─── getBotToken — D1-first ───────────────────────────────────────────────────

describe('getBotToken — D1-first with KV fallback', () => {
  let ctx;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('returns decrypted token from D1 when token_encrypted is set', async () => {
    const token = '123456789:AABBCCDDEEFFGGHHIIJJKKLLMMNNOOPPtest';
    // putBot encrypts and writes token_encrypted to D1 (and KV)
    await putBot(ctx, 'bot1', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, ENC_KEY);

    // Wipe KV to prove D1 path is taken, not KV
    await ctx.kv.delete('bottoken:bot1');

    const result = await getBotToken(ctx, 'bot1', ENC_KEY);
    expect(result).toBe(token);
  });

  it('falls back to KV when D1 row has token_encrypted = null', async () => {
    // Insert a bots row without token_encrypted (simulates a pre-migration row)
    await ctx.db
      .prepare(
        `INSERT OR REPLACE INTO bots
           (bot_id, tenant_id, webhook_secret, active, token_encrypted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind('bot2', 't1', 'sec', 1, null, 1000, 1000)
      .run();

    // Put an encrypted token in KV
    const token = '987654321:ZZYYXXWWVVUUTTSSRRQQPPOONNMMtest';
    const encrypted = await encryptToken(token, ENC_KEY, BOT_TOKEN_LABEL);
    await ctx.kv.put('bottoken:bot2', encrypted);

    const result = await getBotToken(ctx, 'bot2', ENC_KEY);
    expect(result).toBe(token);
  });

  it('returns null when both D1 and KV are empty', async () => {
    const result = await getBotToken(ctx, 'nonexistent-bot', ENC_KEY);
    expect(result).toBeNull();
  });

  it('returns null when ctx has no db and no kv', async () => {
    const result = await getBotToken({}, 'bot1', ENC_KEY);
    expect(result).toBeNull();
  });

  it('returns null for falsy botId', async () => {
    expect(await getBotToken(ctx, null, ENC_KEY)).toBeNull();
    expect(await getBotToken(ctx, '', ENC_KEY)).toBeNull();
  });
});

// ─── putBot — D1 token_encrypted write ───────────────────────────────────────

describe('putBot — writes token_encrypted to D1', () => {
  let ctx;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('stores token_encrypted in D1 bots row', async () => {
    const token = '111222333:AABBCCDDEEFFGGHHtest';
    const ok = await putBot(ctx, 'bot3', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, ENC_KEY);
    expect(ok).toBe(true);

    const row = await ctx.db
      .prepare('SELECT token_encrypted FROM bots WHERE bot_id = ?')
      .bind('bot3')
      .first();
    expect(row).toBeTruthy();
    expect(typeof row.token_encrypted).toBe('string');
    // Encrypted value must be pure base64 — no colon
    expect(row.token_encrypted.includes(':')).toBe(false);
  });

  it('also writes encrypted token to KV (belt-and-suspenders)', async () => {
    const token = '444555666:CCDDEEFFtest';
    await putBot(ctx, 'bot4', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, ENC_KEY);

    const kvVal = await ctx.kv.get('bottoken:bot4', 'text');
    expect(kvVal).toBeTruthy();
    expect(typeof kvVal).toBe('string');
    expect(kvVal.includes(':')).toBe(false); // encrypted, not plaintext
  });

  it('stores null for token_encrypted when no botToken provided', async () => {
    const ok = await putBot(ctx, 'bot5', { tenantId: 't1', webhookSecret: 'sec' }, ENC_KEY);
    expect(ok).toBe(true);

    const row = await ctx.db
      .prepare('SELECT token_encrypted FROM bots WHERE bot_id = ?')
      .bind('bot5')
      .first();
    expect(row).toBeTruthy();
    expect(row.token_encrypted).toBeNull();
  });

  it('D1 and KV token_encrypted values are identical', async () => {
    const token = '777888999:XXYYZZtest';
    await putBot(ctx, 'bot6', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, ENC_KEY);

    const row = await ctx.db
      .prepare('SELECT token_encrypted FROM bots WHERE bot_id = ?')
      .bind('bot6')
      .first();
    const kvVal = await ctx.kv.get('bottoken:bot6', 'text');

    expect(row.token_encrypted).toBe(kvVal);
  });
});
