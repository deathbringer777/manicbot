/**
 * Tests for KV → D1 bot token migration (migration complete 2026-05-08).
 *
 * D1 bots.token_encrypted is the sole source of truth.
 * getBotToken reads exclusively from D1; no KV fallback.
 * putBot writes exclusively to D1; no KV dual-write.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getBotToken, putBot } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';

const ENC_KEY = 'test-encryption-key-32-bytes-long!!';

function makeCtx() {
  const db = createMockD1();
  const kv = makeMockKv();
  return { db, kv, globalKv: kv };
}

// ─── getBotToken — D1-only ────────────────────────────────────────────────────

describe('getBotToken — D1-only (migration complete)', () => {
  let ctx;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('returns decrypted token from D1 when token_encrypted is set', async () => {
    const token = '123456789:AABBCCDDEEFFGGHHIIJJKKLLMMNNOOPPtest';
    await putBot(ctx, 'bot1', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, ENC_KEY);

    const result = await getBotToken(ctx, 'bot1', ENC_KEY);
    expect(result).toBe(token);
  });

  it('returns null when D1 row has token_encrypted = null (no KV fallback)', async () => {
    // Insert a bots row without token_encrypted
    await ctx.db
      .prepare(
        `INSERT OR REPLACE INTO bots
           (bot_id, tenant_id, webhook_secret, active, token_encrypted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind('bot2', 't1', 'sec', 1, null, 1000, 1000)
      .run();

    // Even if KV has something, D1-null means null — no fallback
    await ctx.kv.put('bottoken:bot2', 'should-be-ignored');

    const result = await getBotToken(ctx, 'bot2', ENC_KEY);
    expect(result).toBeNull();
  });

  it('returns null when D1 has no row for botId', async () => {
    const result = await getBotToken(ctx, 'nonexistent-bot', ENC_KEY);
    expect(result).toBeNull();
  });

  it('returns null when ctx has no db', async () => {
    const result = await getBotToken({}, 'bot1', ENC_KEY);
    expect(result).toBeNull();
  });

  it('returns null for falsy botId', async () => {
    expect(await getBotToken(ctx, null, ENC_KEY)).toBeNull();
    expect(await getBotToken(ctx, '', ENC_KEY)).toBeNull();
  });
});

// ─── putBot — D1-only token write ────────────────────────────────────────────

describe('putBot — writes token_encrypted to D1 only', () => {
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

  it('does NOT write to KV (D1 is sole storage)', async () => {
    const token = '444555666:CCDDEEFFtest';
    await putBot(ctx, 'bot4', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, ENC_KEY);

    const kvVal = await ctx.kv.get('bottoken:bot4', 'text');
    expect(kvVal).toBeNull();
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

  it('returns false when no encryptionKey provided (refuses plaintext storage)', async () => {
    const token = '777888999:XXYYZZtest';
    const ok = await putBot(ctx, 'bot6', { tenantId: 't1', botToken: token, webhookSecret: 'sec' }, null);
    expect(ok).toBe(false);
  });
});
