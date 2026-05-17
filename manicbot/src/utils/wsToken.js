/**
 * @fileoverview Short-lived signed token for /ws/messenger upgrade.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 of payload)>`
 * Payload: `{ tenantId, webUserId, exp }` (exp = unix seconds, max +60s).
 *
 * Issued by admin-app (`messenger.issueWsToken`) and verified by the Worker
 * (`/ws/messenger/{tenantId}` route). Same `WS_TOKEN_SECRET` env var on
 * both sides. Token is one-shot in practice — short TTL + no reuse tracking
 * (a stolen token is only useful for ~60s and is bound to one tenant
 * anyway).
 *
 * Why not full JWT? The admin-app already runs on edge and depends on Web
 * Crypto for password hashing; pulling a JWT lib in just for this would
 * be overkill. HS256 on a tiny payload is sufficient.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(buf) {
  // buf can be Uint8Array or string
  const bytes = typeof buf === 'string' ? encoder.encode(buf) : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  // btoa is available in workers/edge runtime
  // eslint-disable-next-line no-undef
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Constant-time equality on byte arrays.
 */
function timingSafeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Mint a signed WS token. ttl clamped to 60s.
 * @param {string} secret - WS_TOKEN_SECRET
 * @param {{ tenantId: string, webUserId: string }} claims
 * @param {number=} ttlSec - default 60
 * @returns {Promise<string>}
 */
export async function mintWsToken(secret, claims, ttlSec = 60) {
  if (!secret) throw new Error('mintWsToken: WS_TOKEN_SECRET not set');
  if (!claims?.tenantId || !claims?.webUserId) throw new Error('mintWsToken: tenantId + webUserId required');
  const ttl = Math.max(1, Math.min(60, ttlSec | 0));
  const payload = {
    tenantId: String(claims.tenantId),
    webUserId: String(claims.webUserId),
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const payloadEnc = base64urlEncode(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadEnc));
  const sigEnc = base64urlEncode(new Uint8Array(sig));
  return `${payloadEnc}.${sigEnc}`;
}

/**
 * Verify + decode a WS token.
 * @param {string} secret
 * @param {string} token
 * @returns {Promise<{tenantId: string, webUserId: string, exp: number}|null>}
 */
export async function verifyWsToken(secret, token) {
  if (!secret || typeof token !== 'string') return null;
  const idx = token.indexOf('.');
  if (idx <= 0 || idx === token.length - 1) return null;
  const payloadEnc = token.slice(0, idx);
  const sigEnc = token.slice(idx + 1);
  try {
    const key = await importHmacKey(secret);
    const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadEnc));
    const provided = base64urlDecodeToBytes(sigEnc);
    if (!timingSafeEqualBytes(new Uint8Array(expected), provided)) return null;
    const payloadJson = decoder.decode(base64urlDecodeToBytes(payloadEnc));
    const claims = JSON.parse(payloadJson);
    if (!claims?.tenantId || !claims?.webUserId || typeof claims?.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
