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
 * Payload shape: { tid: string, kind: 'logo'|'cover'|'photo'|'portfolio', exp: number }
 *
 * Edge-runtime compatible (uses Web Crypto API only — no Node-specific imports).
 */

import { timingSafeEqual } from '../utils/security.js';

export const ALLOWED_KINDS = new Set(['logo', 'cover', 'photo', 'portfolio', 'service_photo', 'client_avatar']);
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
 * @returns {Promise<string>} signed token
 */
export async function signUploadToken({ tid, kind, secret, ttlSec = DEFAULT_TOKEN_TTL_SEC }) {
  if (!tid || typeof tid !== 'string') throw new Error('tid required');
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`invalid kind: ${kind}`);
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    throw new Error('UPLOAD_TOKEN_SECRET missing or too short (>= 16 chars)');
  }
  const payload = { tid, kind, exp: Math.floor(Date.now() / 1000) + ttlSec };
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
 * @returns {Promise<{tid:string, kind:string, exp:number}|null>}
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

  return { tid: payload.tid, kind: payload.kind, exp: payload.exp };
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
