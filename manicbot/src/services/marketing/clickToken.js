/**
 * @fileoverview Signed click-tracking token for /r/<token> redirects.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 of payload)>`
 * Payload: `{ c, s, t, ct, u, exp }` —
 *   c  = campaignId, s = sendId, t = tenantId, ct = contactId,
 *   u  = destination URL (SIGNED — the redirect can only ever go where the
 *        sender originally pointed it; a tampered token fails verification),
 *   exp = unix seconds (default +90d so links stay valid long after send).
 *
 * Minted at send time by BOTH senders (Worker `services/marketing/sender.js`
 * and admin-app `server/marketing/sender.ts`, whose `clickToken.ts` twin
 * produces byte-identical tokens with the same key-order payload), and
 * verified by the Worker `/r/` endpoint. Same `CLICK_TOKEN_SECRET` env var on
 * both sides. HS256 over a tiny payload — no JWT lib needed (mirrors wsToken.js).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Default token lifetime — emails get clicked weeks later. */
export const CLICK_TOKEN_TTL_SEC = 90 * 24 * 60 * 60;

function base64urlEncode(buf) {
  const bytes = typeof buf === 'string' ? encoder.encode(buf) : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecodeToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
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
    ['sign'],
  );
}

function timingSafeEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Mint a signed click token.
 * @param {string} secret - CLICK_TOKEN_SECRET
 * @param {{ campaignId: string, sendId?: string|null, tenantId: string, contactId?: number|null, url: string }} claims
 * @param {number=} ttlSec
 * @returns {Promise<string>}
 */
export async function signClickToken(secret, claims, ttlSec = CLICK_TOKEN_TTL_SEC, nowSec = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error('signClickToken: CLICK_TOKEN_SECRET not set');
  if (!claims?.campaignId || !claims?.tenantId || !claims?.url) {
    throw new Error('signClickToken: campaignId + tenantId + url required');
  }
  // Fixed key order so the admin-app twin produces byte-identical tokens.
  const payload = {
    c: String(claims.campaignId),
    s: claims.sendId != null ? String(claims.sendId) : null,
    t: String(claims.tenantId),
    ct: claims.contactId != null ? Number(claims.contactId) : null,
    u: String(claims.url),
    exp: nowSec + Math.max(60, ttlSec | 0),
  };
  const payloadEnc = base64urlEncode(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadEnc));
  return `${payloadEnc}.${base64urlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify + decode a click token. Returns the normalized claims or null.
 * @param {string} secret
 * @param {string} token
 * @param {number=} nowSec
 * @returns {Promise<{campaignId: string, sendId: string|null, tenantId: string, contactId: number|null, url: string, exp: number}|null>}
 */
export async function verifyClickToken(secret, token, nowSec = Math.floor(Date.now() / 1000)) {
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
    const claims = JSON.parse(decoder.decode(base64urlDecodeToBytes(payloadEnc)));
    if (!claims?.c || !claims?.t || !claims?.u || typeof claims?.exp !== 'number') return null;
    if (claims.exp < nowSec) return null;
    return {
      campaignId: String(claims.c),
      sendId: claims.s != null ? String(claims.s) : null,
      tenantId: String(claims.t),
      contactId: claims.ct != null ? Number(claims.ct) : null,
      url: String(claims.u),
      exp: claims.exp,
    };
  } catch {
    return null;
  }
}
