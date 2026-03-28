/**
 * Tests for meta-verify.js:
 *  - verifyMetaSignature (HMAC-SHA256)
 *  - handleHubChallenge (hub.challenge verification)
 *
 * Note: crypto.subtle.timingSafeEqual is a Cloudflare Workers extension.
 * We polyfill it for Node.js test environment.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { verifyMetaSignature, handleHubChallenge } from '../src/channels/meta-verify.js';

// Polyfill crypto.subtle.timingSafeEqual for Node.js (Workers-only API)
beforeAll(() => {
  if (typeof crypto !== 'undefined' && crypto.subtle && !crypto.subtle.timingSafeEqual) {
    crypto.subtle.timingSafeEqual = (a, b) => {
      const ua = new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer);
      const ub = new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer);
      if (ua.length !== ub.length) return false;
      let diff = 0;
      for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
      return diff === 0;
    };
  }
});

// ─── verifyMetaSignature ──────────────────────────────────────────────────────

describe('verifyMetaSignature', () => {
  // Pre-computed: HMAC-SHA256(key='test_secret', body='{"hello":"world"}')
  // We use the function itself to generate expected values in tests.

  it('returns false when signature header is missing', async () => {
    expect(await verifyMetaSignature('body', '', 'secret')).toBe(false);
    expect(await verifyMetaSignature('body', null, 'secret')).toBe(false);
  });

  it('returns false when appSecret is missing', async () => {
    expect(await verifyMetaSignature('body', 'sha256=abc', '')).toBe(false);
    expect(await verifyMetaSignature('body', 'sha256=abc', null)).toBe(false);
  });

  it('accepts sha256= prefix in signature header', async () => {
    const body = '{"test":1}';
    const secret = 'my_app_secret';
    // Generate the correct signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    expect(await verifyMetaSignature(body, `sha256=${hex}`, secret)).toBe(true);
  });

  it('accepts raw hex signature (no prefix)', async () => {
    const body = '{"test":2}';
    const secret = 'another_secret';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    expect(await verifyMetaSignature(body, hex, secret)).toBe(true);
  });

  it('returns false for wrong signature', async () => {
    expect(await verifyMetaSignature('body', 'sha256=wronghex000', 'secret')).toBe(false);
  });

  it('returns false when body does not match signature', async () => {
    const body1 = '{"data":"original"}';
    const body2 = '{"data":"tampered"}';
    const secret = 'shared_secret';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body1));
    const hex = Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');

    // Valid for body1
    expect(await verifyMetaSignature(body1, `sha256=${hex}`, secret)).toBe(true);
    // Invalid for body2 (tampered)
    expect(await verifyMetaSignature(body2, `sha256=${hex}`, secret)).toBe(false);
  });
});

// ─── handleHubChallenge ───────────────────────────────────────────────────────

describe('handleHubChallenge', () => {
  function makeUrl(params) {
    const url = new URL('https://example.com/webhook/wa');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url;
  }

  it('returns 200 with challenge when token matches', async () => {
    const url = makeUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123', 'hub.verify_token': 'mytoken' });
    const res = handleHubChallenge(url, 'mytoken');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
  });

  it('returns 403 when token does not match', () => {
    const url = makeUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'xyz', 'hub.verify_token': 'wrong_token' });
    const res = handleHubChallenge(url, 'correct_token');
    expect(res.status).toBe(403);
  });

  it('returns 403 when mode is not subscribe', () => {
    const url = makeUrl({ 'hub.mode': 'unsubscribe', 'hub.challenge': 'abc', 'hub.verify_token': 'token' });
    const res = handleHubChallenge(url, 'token');
    expect(res.status).toBe(403);
  });

  it('returns 403 when stored token is empty', () => {
    const url = makeUrl({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc', 'hub.verify_token': '' });
    const res = handleHubChallenge(url, '');
    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.mode is missing', () => {
    const url = makeUrl({ 'hub.challenge': 'abc', 'hub.verify_token': 'mytoken' });
    const res = handleHubChallenge(url, 'mytoken');
    expect(res.status).toBe(403);
  });
});
