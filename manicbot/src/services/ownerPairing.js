/**
 * Owner Telegram pairing — single-use deep-link tokens that bind a
 * salon-owner's `web_users.telegram_chat_id` (and a matching
 * `tenant_roles` row) to their real Telegram account.
 *
 * Symmetric to `services/masterPairing.js` (migration 0074). Differs
 * in two ways:
 *
 *   1. Identity: the code references a `web_user_id` (the owner's web
 *      account) instead of a `master_chat_id`. There is no synthetic
 *      chat_id for owners — they live entirely in `web_users` until
 *      they pair.
 *   2. On consume the Worker performs THREE writes in a single batch:
 *        a. `UPDATE web_users SET telegram_chat_id = <real_tg>` so the
 *           dashboard can show the paired state.
 *        b. `INSERT OR REPLACE INTO tenant_roles (tenant_id, chat_id,
 *           role='tenant_owner')` so the existing `resolveRole` lookup
 *           in `src/services/users.js` finds the owner without any
 *           change to the resolution path.
 *        c. Stamps the code consumed.
 *
 * Pure-functional pieces (`generatePairingToken`, `hashPairingToken`,
 * `buildDeepLink`) are exported so admin-app mirrors and tests can
 * verify hash determinism without DB access.
 */

import { dbGet, dbRun, dbBatch } from '../utils/db.js';
import { log } from '../utils/logger.js';
import { ROLES } from '../roles/roles.js';

export const PAIRING_TOKEN_BYTES = 24;            // ~32 base64url chars
export const PAIRING_TOKEN_TTL_SEC = 7 * 24 * 3600; // 7 days

// ─── Pure helpers ─────────────────────────────────────────────────────

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a fresh pairing token. Returns `{ raw, hash }` so the
 * caller can hand `raw` to the owner (in the URL) and persist only
 * `hash`.
 *
 * @returns {Promise<{ raw: string, hash: string }>}
 */
export async function generatePairingToken() {
  const bytes = new Uint8Array(PAIRING_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const raw = b64urlEncode(bytes);
  const hash = await hashPairingToken(raw);
  return { raw, hash };
}

/**
 * Storage hash for a raw token. Deterministic.
 *
 * @param {string} raw
 * @returns {Promise<string>} SHA-256 hex (64 chars)
 */
export async function hashPairingToken(raw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const arr = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Build the Telegram deep-link URL. `own_` prefix mirrors the
 * existing `mst_` master-pairing convention.
 *
 * @param {string} botUsername  Telegram bot username (with or without `@`).
 * @param {string} rawToken
 * @returns {string}
 */
export function buildDeepLink(botUsername, rawToken) {
  const u = botUsername.replace(/^@/, '');
  return `https://t.me/${u}?start=own_${rawToken}`;
}

// ─── DB ops ───────────────────────────────────────────────────────────

/**
 * Insert a new pairing code. Caller is responsible for the
 * authorization check (the tRPC layer asserts the requesting
 * web_user IS the owner of the named tenant).
 *
 * @param {object} ctx
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.webUserId  The owner's `web_users.id`.
 * @returns {Promise<{ raw: string, hash: string, expiresAt: number }>}
 */
export async function createPairingCode(ctx, { tenantId, webUserId }) {
  const { raw, hash } = await generatePairingToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PAIRING_TOKEN_TTL_SEC;

  await dbRun(
    ctx,
    `INSERT INTO owner_pairing_codes
       (token_hash, tenant_id, web_user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    hash, tenantId, webUserId, now, expiresAt,
  );

  return { raw, hash, expiresAt };
}

/**
 * Attempt to consume an owner-pairing code on the Worker side. Called
 * from the `/start own_<rawToken>` branch of `handlers/message.js`.
 *
 * Cross-tenant guard: the bot's resolved `tenantId` MUST match the
 * code's `tenant_id`. Codes minted for tenant A cannot be consumed by
 * a user opening tenant B's bot — even if they intercept the raw
 * token.
 *
 * Atomic execution: the three writes (web_users update, tenant_roles
 * upsert, code stamp) go through `dbBatch` so a half-applied state is
 * not possible.
 *
 * Idempotency: a code already marked consumed returns
 * `{ ok: false, reason: 'consumed' }`. A code whose web_user is now
 * paired to ANOTHER chat returns `{ ok: false, reason: 'tg_chat_in_use' }` —
 * the owner should unpair first or mint a new code targeting a
 * different chat.
 *
 * @param {object} ctx     Worker context with `ctx.db` + `ctx.tenantId`.
 * @param {string} rawToken
 * @param {number} chatId  Real Telegram chat_id of the inbound user.
 * @returns {Promise<{ ok: true, webUserId: string, tenantId: string, ownerName: string|null } | { ok: false, reason: string }>}
 */
export async function tryConsumePairingCode(ctx, rawToken, chatId) {
  if (!ctx?.db || !ctx?.tenantId) return { ok: false, reason: 'no_db' };
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 128) {
    return { ok: false, reason: 'invalid_token' };
  }
  const hash = await hashPairingToken(rawToken);
  const code = await dbGet(
    ctx,
    `SELECT token_hash, tenant_id, web_user_id, expires_at, consumed_at
       FROM owner_pairing_codes WHERE token_hash = ?`,
    hash,
  );
  if (!code) return { ok: false, reason: 'not_found' };
  if (code.tenant_id !== ctx.tenantId) {
    log.warn?.('owner-pairing', {
      message: 'cross-tenant consume rejected',
      tokenTenant: code.tenant_id,
      botTenant: ctx.tenantId,
    });
    return { ok: false, reason: 'wrong_tenant' };
  }
  if (code.consumed_at) return { ok: false, reason: 'consumed' };
  const now = Math.floor(Date.now() / 1000);
  if (code.expires_at < now) return { ok: false, reason: 'expired' };

  // Verify the web_user still exists AND still belongs to the same
  // tenant. Detaching the user from the tenant between mint + consume
  // invalidates the code — defense-in-depth on top of the cross-tenant
  // guard above.
  const wu = await dbGet(
    ctx,
    `SELECT id, tenant_id, name FROM web_users WHERE id = ?`,
    code.web_user_id,
  );
  if (!wu) return { ok: false, reason: 'web_user_gone' };
  if (wu.tenant_id !== ctx.tenantId) return { ok: false, reason: 'web_user_tenant_changed' };

  // Partial UNIQUE on `web_users(telegram_chat_id) WHERE NOT NULL`:
  // friendly-error instead of a SQLite constraint violation on the
  // batch below.
  const existing = await dbGet(
    ctx,
    `SELECT id FROM web_users WHERE telegram_chat_id = ? AND id != ?`,
    chatId, code.web_user_id,
  );
  if (existing) return { ok: false, reason: 'tg_chat_in_use' };

  try {
    await dbBatch(ctx, [
      [
        `UPDATE web_users SET telegram_chat_id = ?, updated_at = ?
           WHERE id = ?`,
        chatId, now, code.web_user_id,
      ],
      [
        `INSERT OR REPLACE INTO tenant_roles (tenant_id, chat_id, role, created_at)
           VALUES (?, ?, ?, ?)`,
        ctx.tenantId, chatId, ROLES.TENANT_OWNER, now,
      ],
      [
        `UPDATE owner_pairing_codes
           SET consumed_at = ?, consumed_chat_id = ?
           WHERE token_hash = ? AND consumed_at IS NULL`,
        now, chatId, hash,
      ],
    ]);
  } catch (e) {
    log.error('owner-pairing', e instanceof Error ? e : new Error(String(e?.message)), {
      action: 'consume_batch',
    });
    return { ok: false, reason: 'db_error' };
  }

  return {
    ok: true,
    webUserId: code.web_user_id,
    tenantId: ctx.tenantId,
    ownerName: wu.name || null,
  };
}

/**
 * Return the active (unconsumed, unexpired) pairing code for a given
 * web_user_id + tenant, or null. Used by the admin-app UI to show
 * "you already have a pending code, copy the link instead of
 * generating a new one". Returns metadata only — never the raw token.
 */
export async function getActivePairingCode(ctx, { tenantId, webUserId }) {
  const now = Math.floor(Date.now() / 1000);
  return dbGet(
    ctx,
    'SELECT token_hash, expires_at, created_at FROM owner_pairing_codes WHERE tenant_id = ? AND web_user_id = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    tenantId, webUserId, now,
  );
}
