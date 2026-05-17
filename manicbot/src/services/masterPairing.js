/**
 * Master Telegram pairing — single-use deep-link tokens that bind a
 * salon-employed master's `masters.telegram_chat_id` to their real
 * Telegram account.
 *
 * Flow (see migration 0074 header for the full rationale):
 *
 *   1. Salon owner OR master mints a token via tRPC. Server stores
 *      `SHA-256(raw)` in `master_pairing_codes`; raw token leaves the
 *      server exactly once as part of the deep-link URL.
 *   2. User opens `t.me/<bot>?start=mst_<raw>` on Telegram. Bot's /start
 *      handler intercepts the `mst_` prefix BEFORE the analytics
 *      `decodeStartPayload` path and calls `tryConsumePairingCode`.
 *   3. On success the function atomically:
 *      - Sets `masters.telegram_chat_id = <real_tg_chat_id>` for the
 *        master row referenced by the code (scoped to the bot's tenant).
 *      - Marks the code consumed.
 *      Returns `{ ok: true, masterChatId, masterName }`.
 *   4. The bot then renders the master panel via `showMasterPanel`.
 *
 * Pure-functional pieces (`generatePairingToken`, `hashPairingToken`,
 * `buildDeepLink`) are exported so tests can pin them without DB access.
 */

import { dbGet, dbRun, dbBatch } from '../utils/db.js';
import { log } from '../utils/logger.js';

export const PAIRING_TOKEN_BYTES = 24;            // ~32 base64url chars
export const PAIRING_TOKEN_TTL_SEC = 7 * 24 * 3600; // 7 days

// ─── Pure helpers ─────────────────────────────────────────────────────

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a fresh pairing token. Returns `{ raw, hash }` so the caller
 * can hand `raw` to the master (URL) and persist only `hash`.
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
 * Compute the storage hash for a raw token. Deterministic — same input
 * always produces the same hash.
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
 * Build the Telegram deep-link URL. Format mirrors the existing
 * acquisition tracking deep-links: `t.me/<bot_username>?start=mst_<raw>`.
 *
 * @param {string} botUsername  Telegram bot username (without `@`).
 * @param {string} rawToken
 * @returns {string}
 */
export function buildDeepLink(botUsername, rawToken) {
  const u = botUsername.replace(/^@/, '');
  return `https://t.me/${u}?start=mst_${rawToken}`;
}

// ─── DB ops ───────────────────────────────────────────────────────────

/**
 * Insert a new pairing code. Caller is responsible for verifying the
 * caller has permission (tRPC layer does this via assertTenantOwner or
 * the master's own web_user_id binding).
 *
 * @param {object} ctx
 * @param {object} args
 * @param {string} args.tenantId
 * @param {number} args.masterChatId
 * @param {string|null} args.createdByWebUserId
 * @returns {Promise<{ raw: string, hash: string, expiresAt: number }>}
 */
export async function createPairingCode(ctx, { tenantId, masterChatId, createdByWebUserId = null }) {
  const { raw, hash } = await generatePairingToken();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PAIRING_TOKEN_TTL_SEC;

  await dbRun(
    ctx,
    `INSERT INTO master_pairing_codes
       (token_hash, tenant_id, master_chat_id, created_by_web_user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    hash, tenantId, masterChatId, createdByWebUserId, now, expiresAt,
  );

  return { raw, hash, expiresAt };
}

/**
 * Attempt to consume a pairing code on the Worker side. Called from the
 * `/start mst_<rawToken>` branch of `handlers/message.js`.
 *
 * Cross-tenant guard: the bot's resolved `tenantId` MUST match the
 * code's `tenant_id`. Codes minted for tenant A cannot be consumed by a
 * user opening tenant B's bot — even if they intercept the raw token.
 *
 * Atomic execution: the row update + the code-consume row write go
 * through `dbBatch` so a half-applied state isn't possible.
 *
 * Idempotency: a code already marked consumed returns `{ ok: false, reason: 'consumed' }`.
 * A code whose master's `telegram_chat_id` is now bound to ANOTHER chat
 * also returns `{ ok: false }` — the salon should mint a fresh code.
 *
 * @param {object} ctx       Worker context with `ctx.db` + `ctx.tenantId`.
 * @param {string} rawToken
 * @param {number} chatId    Real Telegram chat_id of the inbound user.
 * @returns {Promise<{ ok: true, masterChatId: number, masterName: string|null } | { ok: false, reason: string }>}
 */
export async function tryConsumePairingCode(ctx, rawToken, chatId) {
  if (!ctx?.db || !ctx?.tenantId) return { ok: false, reason: 'no_db' };
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 128) {
    return { ok: false, reason: 'invalid_token' };
  }
  const hash = await hashPairingToken(rawToken);
  const code = await dbGet(
    ctx,
    `SELECT token_hash, tenant_id, master_chat_id, expires_at, consumed_at
       FROM master_pairing_codes WHERE token_hash = ?`,
    hash,
  );
  if (!code) return { ok: false, reason: 'not_found' };
  if (code.tenant_id !== ctx.tenantId) {
    // Cross-tenant: never accept. Log at warn so we can spot scans.
    log.warn?.('master-pairing', {
      message: 'cross-tenant consume rejected',
      tokenTenant: code.tenant_id,
      botTenant: ctx.tenantId,
    });
    return { ok: false, reason: 'wrong_tenant' };
  }
  if (code.consumed_at) return { ok: false, reason: 'consumed' };
  const now = Math.floor(Date.now() / 1000);
  if (code.expires_at < now) return { ok: false, reason: 'expired' };

  // Verify the master row still exists and is unarchived.
  const master = await dbGet(
    ctx,
    `SELECT chat_id, name, archived_at FROM masters WHERE tenant_id = ? AND chat_id = ?`,
    ctx.tenantId, code.master_chat_id,
  );
  if (!master) return { ok: false, reason: 'master_gone' };
  if (master.archived_at) return { ok: false, reason: 'master_archived' };

  // Check the partial UNIQUE (tenant_id, telegram_chat_id WHERE NOT NULL)
  // proactively so we can return a friendly error instead of a SQLite
  // constraint error.
  const existing = await dbGet(
    ctx,
    `SELECT chat_id FROM masters
       WHERE tenant_id = ? AND telegram_chat_id = ? AND chat_id != ?`,
    ctx.tenantId, chatId, code.master_chat_id,
  );
  if (existing) return { ok: false, reason: 'tg_chat_in_use' };

  try {
    await dbBatch(ctx, [
      [
        `UPDATE masters SET telegram_chat_id = ?
           WHERE tenant_id = ? AND chat_id = ?`,
        chatId, ctx.tenantId, code.master_chat_id,
      ],
      [
        `UPDATE master_pairing_codes
           SET consumed_at = ?, consumed_chat_id = ?
           WHERE token_hash = ? AND consumed_at IS NULL`,
        now, chatId, hash,
      ],
    ]);
  } catch (e) {
    log.error('master-pairing', e instanceof Error ? e : new Error(String(e?.message)), {
      action: 'consume_batch',
    });
    return { ok: false, reason: 'db_error' };
  }

  return {
    ok: true,
    masterChatId: code.master_chat_id,
    masterName: master.name || null,
  };
}

/**
 * Return the active (unconsumed, unexpired) pairing code for a master,
 * or null if none. Used by the master-dashboard UI to show "code already
 * pending, copy the link instead of generating a new one".
 *
 * Only returns metadata — never the raw token. By design.
 */
export async function getActivePairingCode(ctx, { tenantId, masterChatId }) {
  const now = Math.floor(Date.now() / 1000);
  // SQL is flattened to one line so the in-memory mock-db parser can match
  // the WHERE / ORDER BY / LIMIT slots in production tests. Real D1 doesn't
  // care about whitespace either.
  return dbGet(
    ctx,
    'SELECT token_hash, expires_at, created_at FROM master_pairing_codes WHERE tenant_id = ? AND master_chat_id = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    tenantId, masterChatId, now,
  );
}
