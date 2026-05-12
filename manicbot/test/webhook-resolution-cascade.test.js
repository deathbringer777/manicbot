/**
 * The bug: when /webhook/{botId} comes in but resolveTenantFromBotId() returns
 * null (token can't decrypt, bot inactive, etc.), worker.js used to fall back
 * to buildLegacyCtx(env). That ctx has env.WEBHOOK_SECRET — which is the
 * legacy single-bot secret, NOT the per-bot one Telegram is sending. So the
 * timingSafeEqual check rejects with 403, Telegram retries forever, and the
 * user sees ✓✓ delivered with no reply. Silent.
 *
 * Fix invariant: for /webhook/{botId} paths, never fall back to legacy ctx.
 * If the bot can't resolve, return null (worker will respond 404 + log event).
 */
import { describe, it, expect } from 'vitest';
import { getCtx } from '../src/http/resolveCtx.js';
import { disallowLegacyWebhook } from '../src/worker.js';
import { putTenant, putBot } from '../src/tenant/storage.js';
import { createMockD1, makeMockKv } from './helpers/mock-db.js';
import { encryptToken } from '../src/utils/security.js';

const ENC_KEY = 'cascade-test-encryption-key-32chars!';
const PLAINTEXT = '987654321:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const BOT_TOKEN_LABEL = 'bot-token-v1';

function makeEnv(overrides = {}) {
  const db = createMockD1();
  const kv = makeMockKv();
  return {
    db, kv,
    env: {
      DB: db,
      MANICBOT: kv,
      BOT_TOKEN: '12345:legacy-token-aaaa',
      WEBHOOK_SECRET: 'legacy-webhook-secret-1234567890',
      BOT_ENCRYPTION_KEY: ENC_KEY,
      REQUIRE_WEBHOOK_BOT_ID: '1',
      ...overrides,
    },
  };
}

function postReq(url) {
  return new Request(url, { method: 'POST' });
}

describe('webhook resolution cascade — /webhook/{botId} must NOT fall through to legacy ctx', () => {
  it('returns null when /webhook/{unknownBotId} (bot row missing)', async () => {
    const { env } = makeEnv();
    const url = new URL('https://x/webhook/999999');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).toBeNull();
  });

  it('returns null when /webhook/{knownBotId} but token_encrypted is corrupt', async () => {
    const { env, db, kv } = makeEnv();
    const ctx0 = { db, kv, globalKv: kv };
    await putTenant(ctx0, 't1', { id: 't1', name: 'Salon', active: true, createdAt: 1, updatedAt: 1 });
    // Insert bot row with junk in token_encrypted (no `:` so the heuristic
    // tries to decrypt; decrypt throws; getBotToken returns null).
    await db.prepare(
      `INSERT OR REPLACE INTO bots
         (bot_id, tenant_id, webhook_secret, active, token_encrypted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind('123', 't1', 'wh-secret-1234567890ab', 1, 'v1$AAAA-corrupt-blob-AAAA', 1, 1).run();

    const url = new URL('https://x/webhook/123');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).toBeNull();
  });

  it('returns null when /webhook/{knownBotId} but bot.active = 0', async () => {
    const { env, db, kv } = makeEnv();
    const ctx0 = { db, kv, globalKv: kv };
    await putTenant(ctx0, 't1', { id: 't1', name: 'Salon', active: true, createdAt: 1, updatedAt: 1 });
    const blob = await encryptToken(PLAINTEXT, ENC_KEY, BOT_TOKEN_LABEL);
    await db.prepare(
      `INSERT OR REPLACE INTO bots
         (bot_id, tenant_id, webhook_secret, active, token_encrypted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind('456', 't1', 'wh-secret-1234567890ab', 0, blob, 1, 1).run();

    const url = new URL('https://x/webhook/456');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).toBeNull();
  });

  it('returns a tenant ctx (not legacy) when /webhook/{knownBotId} resolves cleanly', async () => {
    const { env, db, kv } = makeEnv();
    const ctx0 = { db, kv, globalKv: kv };
    await putTenant(ctx0, 't1', { id: 't1', name: 'Salon', active: true, createdAt: 1, updatedAt: 1 });
    await putBot(ctx0, '789', {
      botId: '789', tenantId: 't1', botToken: PLAINTEXT,
      webhookSecret: 'per-bot-secret-1234567890ab', active: true,
      createdAt: 1, updatedAt: 1,
    }, ENC_KEY);

    const url = new URL('https://x/webhook/789');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).not.toBeNull();
    expect(ctx.tenantId).toBe('t1');
    expect(ctx.WEBHOOK_SECRET).toBe('per-bot-secret-1234567890ab');
    // Critical: the per-bot secret, not the legacy one.
    expect(ctx.WEBHOOK_SECRET).not.toBe(env.WEBHOOK_SECRET);
  });
});

describe('disallowLegacyWebhook — refuses legacy fallback for /webhook/{botId}', () => {
  // The point of this predicate: when getCtx returns null for /webhook/{botId},
  // worker.js must NOT silently substitute a legacy ctx (env.WEBHOOK_SECRET) —
  // that would force a 403 secret-mismatch on every Telegram retry. Instead we
  // want a loud 404.

  function envWithMt(overrides = {}) {
    return {
      DB: {},
      REQUIRE_WEBHOOK_BOT_ID: '1',
      ...overrides,
    };
  }

  it('blocks legacy fallback for /webhook (legacy single-bot path) in MT mode', () => {
    const env = envWithMt();
    const url = new URL('https://x/webhook');
    const req = new Request(url, { method: 'POST' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(true);
  });

  it('blocks legacy fallback for /webhook/{botId} in MT mode (the regression fix)', () => {
    const env = envWithMt();
    const url = new URL('https://x/webhook/12345');
    const req = new Request(url, { method: 'POST' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(true);
  });

  it('does NOT block /webhook/wa (Meta WhatsApp path)', () => {
    const env = envWithMt();
    const url = new URL('https://x/webhook/wa');
    const req = new Request(url, { method: 'POST' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(false);
  });

  it('does NOT block /webhook/ig (Meta Instagram path)', () => {
    const env = envWithMt();
    const url = new URL('https://x/webhook/ig');
    const req = new Request(url, { method: 'POST' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(false);
  });

  it('does NOT block when REQUIRE_WEBHOOK_BOT_ID is not set (single-bot mode)', () => {
    const env = { DB: {}, REQUIRE_WEBHOOK_BOT_ID: '0' };
    const url = new URL('https://x/webhook/12345');
    const req = new Request(url, { method: 'POST' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(false);
  });

  it('does NOT block when DB is unbound (no multi-tenant infra)', () => {
    const env = { REQUIRE_WEBHOOK_BOT_ID: '1' /* no DB */ };
    const url = new URL('https://x/webhook/12345');
    const req = new Request(url, { method: 'POST' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(false);
  });

  it('does NOT block GET requests (only POST webhooks)', () => {
    const env = envWithMt();
    const url = new URL('https://x/webhook/12345');
    const req = new Request(url, { method: 'GET' });
    expect(disallowLegacyWebhook(env, req, url)).toBe(false);
  });
});

describe('webhook resolution cascade — fallback paths still correct', () => {
  // P2-3 — legacy bot ctx is opt-in (default off). These tests pre-date the
  // gate and need ALLOW_LEGACY_BOT_CTX=1 to exercise the legacy fall-through.
  it('/webhook/wa is treated as Meta path, not Telegram bot id (legacy ctx OK)', async () => {
    const { env } = makeEnv({ REQUIRE_WEBHOOK_BOT_ID: '0', ALLOW_LEGACY_BOT_CTX: '1' });
    const url = new URL('https://x/webhook/wa');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).not.toBeNull();
    expect(ctx.prefix).toBe('b:12345:'); // legacy
  });

  it('/webhook/ig is treated as Meta path, not Telegram bot id (legacy ctx OK)', async () => {
    const { env } = makeEnv({ REQUIRE_WEBHOOK_BOT_ID: '0', ALLOW_LEGACY_BOT_CTX: '1' });
    const url = new URL('https://x/webhook/ig');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).not.toBeNull();
    expect(ctx.prefix).toBe('b:12345:'); // legacy
  });

  it('/webhook/wa without ALLOW_LEGACY_BOT_CTX returns null (P2-3 default)', async () => {
    const { env } = makeEnv({ REQUIRE_WEBHOOK_BOT_ID: '0' });
    const url = new URL('https://x/webhook/wa');
    const ctx = await getCtx(env, url, postReq(url));
    expect(ctx).toBeNull();
  });
});
