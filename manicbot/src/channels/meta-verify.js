/**
 * @fileoverview Meta (Facebook/Instagram) webhook verification utilities.
 *
 * Shared for both WhatsApp Cloud API and Instagram Messaging API.
 * Meta sends the same HMAC-SHA256 signature scheme on both platforms.
 */

import { timingSafeEqual } from '../utils/security.js';

/**
 * Verify the X-Hub-Signature-256 header sent by Meta on POST webhooks.
 *
 * Meta computes: HMAC-SHA256(appSecret, rawBody) and sends it as
 *   X-Hub-Signature-256: sha256=<hex>
 *
 * @param {string|ArrayBuffer} body - Raw request body (string or bytes)
 * @param {string} signatureHeader  - Value of X-Hub-Signature-256 header
 * @param {string} appSecret        - META_APP_SECRET env variable
 * @returns {Promise<boolean>}
 */
export async function verifyMetaSignature(body, signatureHeader, appSecret) {
  if (!signatureHeader || !appSecret) return false;

  const expected = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;

  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(appSecret);
  const bodyBytes = typeof body === 'string' ? encoder.encode(body) : body;

  try {
    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, bodyBytes);
    const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    // Constant-time comparison
    return timingSafeEqual(hex, expected);
  } catch (e) {
    console.error('[meta-verify] signature check failed:', e.message);
    return false;
  }
}

/**
 * Respond to Meta's webhook verification GET request (hub challenge).
 *
 * Meta sends:
 *   GET /webhook?hub.mode=subscribe&hub.challenge=<token>&hub.verify_token=<myToken>
 *
 * We must echo back hub.challenge if hub.verify_token matches our stored value.
 *
 * @param {URL} url                - Parsed URL of the incoming request
 * @param {string} storedVerifyToken - Our verify token (from env or channel_config)
 * @returns {Response}
 */
export function handleHubChallenge(url, storedVerifyToken) {
  const mode = url.searchParams.get('hub.mode');
  const challenge = url.searchParams.get('hub.challenge');
  const token = url.searchParams.get('hub.verify_token');

  if (
    mode === 'subscribe' &&
    token &&
    storedVerifyToken &&
    timingSafeEqual(token, storedVerifyToken)
  ) {
    return new Response(challenge ?? '', { status: 200 });
  }
  return new Response('Forbidden — verify_token mismatch', { status: 403 });
}
