/**
 * Constant-time comparison of two strings (UTF-8 bytes).
 * Do not use crypto.subtle.timingSafeEqual here: it returns a Promise; callers expect a boolean.
 */
export function timingSafeEqual(a, b) {
  if (a == null || b == null) return false;
  const ta = new TextEncoder().encode(String(a));
  const tb = new TextEncoder().encode(String(b));
  // XOR lengths into diff first — no early return to avoid timing side-channel
  const maxLen = Math.max(ta.length, tb.length);
  let diff = ta.length ^ tb.length;
  for (let i = 0; i < maxLen; i++) diff |= (ta[i] || 0) ^ (tb[i] || 0);
  return diff === 0;
}

export function checkAdmin(request, adminKey) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(auth.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    return timingSafeEqual(decoded.slice(idx + 1), adminKey);
  } catch { return false; }
}

/**
 * #S10: Rate-limited wrapper around checkAdmin.
 *
 * Returns null when the caller passes auth (use the response to short-circuit).
 * Returns a 401 when auth fails — but only after counting it toward a
 * per-credential lockout. Returns a 429 when the credential has too many
 * recent failures (5 in 15 min by default).
 *
 * Per-credential — NOT per-IP — because admin-app's egress shares Cloudflare
 * pop IPs with the world; per-IP lockout would let admin-app DoS itself.
 *
 * @param {Request} request
 * @param {{ ADMIN_KEY?: string, db?: any }} ctx - Worker ctx with DB binding
 * @param {object} [opts]
 * @param {number} [opts.limit=5]
 * @param {number} [opts.windowSec=900]
 * @returns {Promise<Response | null>} null on success, Response on failure
 */
export async function requireAdmin(request, ctx, opts = {}) {
  const limit = opts.limit ?? 5;
  const windowSec = opts.windowSec ?? 900;
  const adminKey = ctx?.ADMIN_KEY;

  // Extract credential for fingerprinting BEFORE checking it — same fingerprint
  // for both wrong and right credential, so the limiter operates on the
  // identity-claim dimension, not the validity dimension.
  const auth = request.headers.get('Authorization') || '';
  let credential = '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(':');
      if (idx >= 0) credential = decoded.slice(idx + 1);
    } catch { /* malformed */ }
  }
  // Fingerprint even on empty credential — that's still an "attempt".
  const { credentialFingerprint, checkCount, checkAndIncrement } = await import('./rateLimit.js');
  const fp = await credentialFingerprint(credential);

  // Pre-check (read-only): if already over limit, refuse without comparing the key.
  if (ctx?.db) {
    const pre = await checkCount(ctx, `admin-auth:${fp}`, 'fail', limit, windowSec);
    if (pre.limited) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': String(pre.retryAfter || 60) },
      });
    }
  }

  if (!adminKey) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="admin"' } });

  // Success path — do NOT increment the failure counter.
  if (checkAdmin(request, adminKey)) return null;

  // Auth failed — increment the failure counter.
  if (ctx?.db) {
    await checkAndIncrement(ctx, `admin-auth:${fp}`, 'fail', limit, windowSec);
  }
  return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="admin"' } });
}

const ALGO = 'AES-GCM';
const IV_LEN = 12;
const TAG_LEN = 128;

// #S6: HKDF subkey derivation (RFC 5869).
// Before this change, BOT_ENCRYPTION_KEY was used directly (slice(0, 32)) for
// AES-GCM encryption of channel tokens, Google refresh tokens, AND HMAC signing
// of calendar URLs — three trust domains, one key. HKDF labels separate them so
// a leak in one domain (e.g. an old calendar URL signature) doesn't compromise
// another (e.g. a TG bot token at rest).
//
// Format: ciphertexts produced via deriveSubkey are stored with a `v1$` prefix.
// decryptToken auto-detects: prefix present → HKDF; absent → legacy slice key.
// This lets existing rows decrypt without rewriting until the lazy/background
// re-encryption migration runs.
const HKDF_SALT = new TextEncoder().encode('manicbot-v1');
const VERSION_PREFIX = 'v1$';

async function importHkdfBaseKey(masterKey) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterKey),
    'HKDF',
    false,
    ['deriveBits'],
  );
}

/**
 * Derive a domain-separated AES-GCM subkey from BOT_ENCRYPTION_KEY using HKDF-SHA256.
 * @param {string} masterKey - BOT_ENCRYPTION_KEY (≥32 chars enforced by callers)
 * @param {string} label     - trust domain, e.g. 'channel-token', 'google-refresh', 'calendar-hmac'
 * @returns {Promise<CryptoKey>} AES-GCM key suitable for encrypt/decrypt
 */
export async function deriveSubkey(masterKey, label) {
  if (!masterKey || masterKey.length < 32) throw new Error('masterKey must be ≥32 chars');
  if (!label || typeof label !== 'string') throw new Error('label required');
  const baseKey = await importHkdfBaseKey(masterKey);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(label) },
    baseKey,
    256,
  );
  return crypto.subtle.importKey('raw', bits, ALGO, false, ['encrypt', 'decrypt']);
}

/**
 * Derive a domain-separated HMAC-SHA256 subkey from BOT_ENCRYPTION_KEY.
 * Used by ics.js to sign calendar download URLs.
 */
export async function deriveHmacSubkey(masterKey, label) {
  if (!masterKey || masterKey.length < 32) throw new Error('masterKey must be ≥32 chars');
  if (!label || typeof label !== 'string') throw new Error('label required');
  const baseKey = await importHkdfBaseKey(masterKey);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(label) },
    baseKey,
    256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function aesGcmEncryptWithKey(plain, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const enc = await crypto.subtle.encrypt(
    { name: ALGO, iv, tagLength: TAG_LEN },
    key,
    new TextEncoder().encode(plain),
  );
  const buf = new Uint8Array(iv.length + enc.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(enc), iv.length);
  return btoa(String.fromCharCode(...buf));
}

async function aesGcmDecryptWithKey(b64, key) {
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = buf.slice(0, IV_LEN);
  const data = buf.slice(IV_LEN);
  const dec = await crypto.subtle.decrypt(
    { name: ALGO, iv, tagLength: TAG_LEN },
    key,
    data,
  );
  return new TextDecoder().decode(dec);
}

/**
 * Encrypt a token with AES-GCM. If `label` is provided, derives an HKDF subkey
 * (preferred). Without a label, uses legacy slice(0, 32) — kept for back-compat
 * during the rotation grace window and removed in Sprint 2.
 *
 * @param {string} plain
 * @param {string} keyStr  - BOT_ENCRYPTION_KEY
 * @param {string} [label] - HKDF label, e.g. 'channel-token' or 'google-refresh'
 */
export async function encryptToken(plain, keyStr, label) {
  if (!keyStr || keyStr.length < 32) return null;
  if (label) {
    const key = await deriveSubkey(keyStr, label);
    return VERSION_PREFIX + await aesGcmEncryptWithKey(plain, key);
  }
  // Legacy path — used by call sites not yet migrated.
  const keyBytes = new TextEncoder().encode(keyStr.slice(0, 32));
  const key = await crypto.subtle.importKey('raw', keyBytes, ALGO, false, ['encrypt']);
  return aesGcmEncryptWithKey(plain, key);
}

/**
 * Decrypt a token. Auto-detects format:
 *  - `v1$...`  → HKDF subkey derived from `label`
 *  - else      → legacy slice(0, 32) key
 *
 * @param {string} encryptedStr
 * @param {string} keyStr   - BOT_ENCRYPTION_KEY
 * @param {string} [label]  - required for v1 ciphertexts; ignored for legacy
 */
export async function decryptToken(encryptedStr, keyStr, label) {
  if (!keyStr || keyStr.length < 32) return null;
  try {
    if (encryptedStr.startsWith(VERSION_PREFIX)) {
      if (!label) {
        // Refuse to silently fall back to a different key domain — would mask bugs.
        return null;
      }
      const key = await deriveSubkey(keyStr, label);
      return await aesGcmDecryptWithKey(encryptedStr.slice(VERSION_PREFIX.length), key);
    }
    // Legacy
    const keyBytes = new TextEncoder().encode(keyStr.slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyBytes, ALGO, false, ['decrypt']);
    return await aesGcmDecryptWithKey(encryptedStr, key);
  } catch {
    return null;
  }
}

export function randomId(byteLength = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteLength)), b => b.toString(36)).join('').slice(0, byteLength * 2);
}
