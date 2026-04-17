/**
 * BOT_ENCRYPTION_KEY rotation + HKDF sweep (Sprint 2/6).
 *
 * After #S6 landed (HKDF subkey derivation), new writes use `v1$...` prefix
 * while existing rows still use the legacy slice(0, 32) format. decryptToken
 * auto-detects, so both read paths work. This sweep re-encrypts legacy rows
 * to the new format — bounds how long the legacy key path has to exist.
 *
 * Safe to run repeatedly: idempotent (rows already in v1 format are skipped).
 * Runs in chunks of 50 to stay under D1's per-statement budget.
 *
 * Invocation (from an admin HTTP route):
 *   await sweepKeyRotation(ctx)
 *
 * Returns per-table counts of rows re-encrypted.
 */

import { encryptToken, decryptToken } from '../src/utils/security.js';
import { dbAll, dbRun } from '../src/utils/db.js';

/** Sweep channel_configs.token_encrypted → label 'channel-token-v1'. */
async function sweepChannelTokens(ctx, key) {
  const rows = await dbAll(ctx, `
    SELECT id, tenant_id, token_encrypted FROM channel_configs
    WHERE token_encrypted IS NOT NULL
      AND token_encrypted NOT LIKE 'v1$%'
    LIMIT 50
  `);
  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      const plain = await decryptToken(row.token_encrypted, key); // legacy path
      if (!plain) { fail++; continue; }
      const reEnc = await encryptToken(plain, key, 'channel-token-v1');
      if (!reEnc) { fail++; continue; }
      await dbRun(ctx,
        'UPDATE channel_configs SET token_encrypted = ?, updated_at = ? WHERE id = ?',
        reEnc, Math.floor(Date.now() / 1000), row.id,
      );
      ok++;
    } catch { fail++; }
  }
  return { table: 'channel_configs', ok, fail, remaining: rows.length };
}

/** Sweep google_integrations.refresh_token_enc → label 'google-refresh-v1'. */
async function sweepGoogleTokens(ctx, key) {
  const rows = await dbAll(ctx, `
    SELECT id, refresh_token_enc FROM google_integrations
    WHERE refresh_token_enc IS NOT NULL
      AND refresh_token_enc NOT LIKE 'v1$%'
    LIMIT 50
  `);
  let ok = 0, fail = 0;
  for (const row of rows) {
    try {
      const plain = await decryptToken(row.refresh_token_enc, key);
      if (!plain) { fail++; continue; }
      const reEnc = await encryptToken(plain, key, 'google-refresh-v1');
      if (!reEnc) { fail++; continue; }
      await dbRun(ctx,
        'UPDATE google_integrations SET refresh_token_enc = ?, updated_at = ? WHERE id = ?',
        reEnc, Math.floor(Date.now() / 1000), row.id,
      );
      ok++;
    } catch { fail++; }
  }
  return { table: 'google_integrations', ok, fail, remaining: rows.length };
}

/**
 * Sweep bot tokens in KV (`bottoken:<botId>`).
 * KV lists are paginated; process 100 keys per call, skip already-v1.
 */
async function sweepKvBotTokens(env, key) {
  if (!env?.MANICBOT?.list) return { table: 'kv:bottoken', ok: 0, fail: 0, remaining: 0 };
  const kv = env.MANICBOT;
  const list = await kv.list({ prefix: 'bottoken:', limit: 100 });
  let ok = 0, fail = 0;
  for (const k of list.keys) {
    try {
      const val = await kv.get(k.name, 'text');
      if (!val) { fail++; continue; }
      if (val.startsWith('v1$')) continue; // already migrated
      if (val.includes(':') && val.match(/^\d+:[A-Za-z0-9_-]+$/)) continue; // raw TG token
      const plain = await decryptToken(val, key);
      if (!plain) { fail++; continue; }
      const reEnc = await encryptToken(plain, key, 'bot-token-v1');
      if (!reEnc) { fail++; continue; }
      await kv.put(k.name, reEnc);
      ok++;
    } catch { fail++; }
  }
  return { table: 'kv:bottoken', ok, fail, remaining: list.keys.length };
}

/**
 * Run one pass of the rotation sweep.
 * Call this from an admin HTTP route; poll until all tables report 0 remaining.
 */
export async function sweepKeyRotation(ctx) {
  const key = ctx?.BOT_ENCRYPTION_KEY;
  if (!key || key.length < 32) return { error: 'BOT_ENCRYPTION_KEY missing or too short' };
  const [channels, google, botTokens] = await Promise.all([
    sweepChannelTokens(ctx, key),
    sweepGoogleTokens(ctx, key),
    sweepKvBotTokens(ctx, key),
  ]);
  return { channels, google, botTokens, timestamp: Date.now() };
}
