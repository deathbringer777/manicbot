/**
 * Web Push crypto layer — RFC 8291 sanity checks.
 *
 * Locks the pure helpers (base64url round-trip, aes128gcm record header
 * shape, VAPID JWT format). The actual ECDH-AES-GCM ciphertext bytes are
 * non-deterministic (random salt + ephemeral keypair) so we assert the
 * envelope structure rather than the bits.
 *
 * Real P-256 key fixtures are generated at suite startup via Node's
 * crypto.generateKeyPairSync — Web Crypto rejects anything that isn't a
 * valid curve point, so the previous static "looks-like-base64url"
 * fixtures were not enough.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {
  b64uToBytes,
  bytesToB64u,
  encryptAes128Gcm,
  buildVapidAuthHeader,
} from '../src/services/webpush.js';

function toB64u(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function p256PairAsBase64u() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkPub = publicKey.export({ format: 'jwk' });
  const jwkPriv = privateKey.export({ format: 'jwk' });
  const x = Buffer.from(jwkPub.x, 'base64');
  const y = Buffer.from(jwkPub.y, 'base64');
  const d = Buffer.from(jwkPriv.d, 'base64');
  const pubRaw = Buffer.concat([Buffer.from([0x04]), x, y]);
  return { publicKey: toB64u(pubRaw), privateKey: toB64u(d) };
}

let RECIPIENT_P256DH;
let RECIPIENT_AUTH;
let VAPID_PUBLIC;
let VAPID_PRIVATE;

beforeAll(() => {
  const recipientPair = p256PairAsBase64u();
  RECIPIENT_P256DH = recipientPair.publicKey;
  RECIPIENT_AUTH = toB64u(randomBytes(16));
  const vapidPair = p256PairAsBase64u();
  VAPID_PUBLIC = vapidPair.publicKey;
  VAPID_PRIVATE = vapidPair.privateKey;
});

describe('base64url round-trip', () => {
  it('encodes + decodes a 16-byte payload', () => {
    const orig = new Uint8Array([0, 1, 2, 3, 254, 255, 128, 64, 32, 16, 8, 4, 2, 1, 100, 200]);
    const round = b64uToBytes(bytesToB64u(orig));
    expect(round).toEqual(orig);
  });

  it('handles empty input', () => {
    expect(bytesToB64u(new Uint8Array(0))).toBe('');
    expect(b64uToBytes('')).toEqual(new Uint8Array(0));
  });

  it('produces url-safe output (no +, /, =)', () => {
    const out = bytesToB64u(new Uint8Array([0xfb, 0xff, 0xbf]));
    expect(out).not.toMatch(/[+/=]/);
  });
});

describe('encryptAes128Gcm — envelope shape (RFC 8188)', () => {
  it('prepends salt + record-size + idlen + ephemeral pubkey + ciphertext', async () => {
    const plain = new TextEncoder().encode('{"title":"hi"}');
    const body = await encryptAes128Gcm(plain, RECIPIENT_P256DH, RECIPIENT_AUTH);

    expect(body.length).toBeGreaterThan(16 + 4 + 1 + 65);

    const recordSize = (body[16] << 24) | (body[17] << 16) | (body[18] << 8) | body[19];
    expect(recordSize).toBe(4096);

    const idlen = body[20];
    expect(idlen).toBe(65);

    // Ephemeral public point begins with 0x04 (uncompressed).
    expect(body[21]).toBe(0x04);
  });

  it('produces different ciphertext each call (random ephemeral + salt)', async () => {
    const plain = new TextEncoder().encode('payload');
    const a = await encryptAes128Gcm(plain, RECIPIENT_P256DH, RECIPIENT_AUTH);
    const b = await encryptAes128Gcm(plain, RECIPIENT_P256DH, RECIPIENT_AUTH);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects malformed recipient public key', async () => {
    await expect(
      encryptAes128Gcm(new Uint8Array([1, 2, 3]), 'AAAA', RECIPIENT_AUTH),
    ).rejects.toThrow(/invalid/);
  });

  it('rejects bad auth secret length', async () => {
    await expect(
      encryptAes128Gcm(new Uint8Array([1, 2, 3]), RECIPIENT_P256DH, 'AAAA'),
    ).rejects.toThrow(/auth_secret/);
  });
});

describe('buildVapidAuthHeader — VAPID JWT (ES256)', () => {
  it('emits the vapid t=...,k=... Authorization header', async () => {
    const auth = await buildVapidAuthHeader(
      'https://fcm.googleapis.com/fcm/send/abc',
      'mailto:ops@manicbot.com',
      VAPID_PUBLIC,
      VAPID_PRIVATE,
    );
    expect(auth.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(auth.authorization).toContain(`k=${VAPID_PUBLIC}`);
  });

  it('JWT payload contains aud + exp + sub', async () => {
    const { authorization } = await buildVapidAuthHeader(
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      'mailto:abc@example.com',
      VAPID_PUBLIC,
      VAPID_PRIVATE,
    );
    const jwt = authorization.split(' ')[1].replace(/^t=/, '').replace(/,.*/, '');
    const payloadB64 = jwt.split('.')[1];
    const pad = '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const json = JSON.parse(
      Buffer.from((payloadB64 + pad).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    expect(json.aud).toBe('https://updates.push.services.mozilla.com');
    expect(json.sub).toBe('mailto:abc@example.com');
    expect(json.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(json.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 12 * 3600 + 5);
  });
});
