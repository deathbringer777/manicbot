/**
 * Signed upload tokens for salon branding assets (logo/cover/photo).
 *
 * Flow:
 *   1. Admin-app tRPC verifies the caller is a tenant owner and mints a token
 *      via `signUploadToken({ tid, kind, exp })`.
 *   2. Client POSTs the file to the Worker's `/upload/asset?t=<token>&kind=<kind>`.
 *   3. Worker calls `verifyUploadToken(token, secret)` → `{ tid, kind }` or null.
 *   4. On success the Worker writes the file to R2 under a content-addressed key.
 *
 * Token format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 *
 * Payload shape: { tid: string, kind: 'logo'|'cover'|..., exp: number, jti: string, uid?: string }
 *
 * Auth = HMAC + TTL + single-use. `jti` is a per-mint nonce; on redemption the
 * Worker atomically claims it (`claimUploadNonce` → `upload_token_used`,
 * migration 0096), so a leaked token still inside its 5-min TTL can be redeemed
 * at most once. `uid` (when present) is the `web_users.id` of the requester,
 * surfaced back for the audit trail (defense-in-depth, not the primary guard).
 *
 * Edge-runtime compatible (uses Web Crypto API only — no Node-specific imports).
 */

import { timingSafeEqual } from '../utils/security.js';
import { nowSec } from '../utils/time.js';

export const ALLOWED_KINDS = new Set(['logo', 'cover', 'photo', 'portfolio', 'service_photo', 'client_avatar', 'master_avatar', 'chat_attachment', 'blog_cover', 'blog_photo', 'cancellation_feedback']);
export const ALLOWED_MIME = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
]);
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
export const DEFAULT_TOKEN_TTL_SEC = 300; // 5 minutes

// ─── base64url helpers ──────────────────────────────────────────────────────

function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlEncodeString(s) {
  return b64urlEncode(new TextEncoder().encode(s));
}

function b64urlDecodeString(s) {
  return new TextDecoder().decode(b64urlDecode(s));
}

// ─── HMAC-SHA256 ────────────────────────────────────────────────────────────

async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Mint a short-lived upload token. Must be called from a trusted server context
 * (admin-app tRPC) after verifying the caller owns the tenant.
 *
 * @param {object} params
 * @param {string} params.tid              tenant id
 * @param {string} params.kind             'logo'|'cover'|'photo'|'portfolio'
 * @param {string} params.secret           UPLOAD_TOKEN_SECRET
 * @param {number} [params.ttlSec]         default 300s
 * @param {string} [params.uid]            optional web_users.id embedded for audit trail
 * @returns {Promise<string>} signed token
 */
export async function signUploadToken({ tid, kind, secret, ttlSec = DEFAULT_TOKEN_TTL_SEC, uid }) {
  if (!tid || typeof tid !== 'string') throw new Error('tid required');
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`invalid kind: ${kind}`);
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    throw new Error('UPLOAD_TOKEN_SECRET missing or too short (>= 16 chars)');
  }
  const payload = {
    tid,
    kind,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    // Single-use nonce — atomically claimed on redemption (see claimUploadNonce).
    jti: crypto.randomUUID(),
  };
  if (uid && typeof uid === 'string') payload.uid = uid;
  const payloadB64 = b64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

/**
 * Verify a signed upload token. Returns the parsed payload on success, or null
 * on any error (malformed token, bad signature, expired, etc.).
 *
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<{tid:string, kind:string, exp:number, uid:string|null}|null>}
 */
export async function verifyUploadToken(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let expected;
  try {
    expected = await hmacSha256(secret, payloadB64);
  } catch {
    return null;
  }
  const expectedB64 = b64urlEncode(expected);
  // Constant-time string compare on the base64url signatures.
  if (!timingSafeEqual(sigB64, expectedB64)) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeString(payloadB64));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  if (!payload.tid || typeof payload.tid !== 'string') return null;
  if (!ALLOWED_KINDS.has(payload.kind)) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

  const uid = typeof payload.uid === 'string' ? payload.uid : null;
  const jti = typeof payload.jti === 'string' ? payload.jti : null;
  return { tid: payload.tid, kind: payload.kind, exp: payload.exp, uid, jti };
}

/**
 * Content-addressed R2 key: `t/{tid}/{kind}-{sha8}.{ext}`.
 * Callers must validate `kind` and `ext` against the allow-lists above.
 */
export async function buildAssetKey(tid, kind, bytes, ext) {
  const hash = await sha256Hex(bytes);
  return `t/${tid}/${kind}-${hash.slice(0, 12)}.${ext}`;
}

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Atomically claim a token's single-use nonce. Returns true iff this is the
 * first redemption of `jti` (caller proceeds), false if it was already spent
 * (caller rejects with 409). Fail-open when the DB binding is absent or the
 * token carries no jti (legacy / mid-deploy) so a degraded edge never blocks a
 * legitimate upload — production always binds DB and mints a jti.
 *
 * @param {{ DB?: D1Database, db?: D1Database }} env
 * @param {string|null} jti
 * @param {number} expSec  token exp — drives the row's cleanup TTL
 * @returns {Promise<boolean>}
 */
export async function claimUploadNonce(env, jti, expSec) {
  const db = env?.DB || env?.db || null;
  if (!db?.prepare || !jti) return true;
  try {
    const res = await db
      .prepare(`INSERT INTO upload_token_used (jti, expires_at) VALUES (?, ?) ON CONFLICT(jti) DO NOTHING`)
      .bind(jti, expSec)
      .run();
    return (res?.meta?.changes ?? 0) === 1;
  } catch {
    // D1 unavailable / migration not yet applied — allow rather than hard-fail uploads.
    return true;
  }
}

/**
 * Prune redeemed-nonce rows past their TTL. Called from worker.scheduled
 * alongside pruneExpiredDedupRows. Uploads are far rarer than webhooks so the
 * live set stays tiny, but unbounded growth is still undesirable.
 *
 * @param {{ DB?: D1Database, db?: D1Database }} env
 * @returns {Promise<{ deleted: number }>}
 */
export async function pruneExpiredUploadNonces(env) {
  const db = env?.DB || env?.db || null;
  if (!db?.prepare) return { deleted: 0 };
  try {
    const res = await db
      .prepare(`DELETE FROM upload_token_used WHERE expires_at < ?`)
      .bind(nowSec())
      .run();
    return { deleted: res?.meta?.changes ?? 0 };
  } catch {
    return { deleted: 0 };
  }
}
