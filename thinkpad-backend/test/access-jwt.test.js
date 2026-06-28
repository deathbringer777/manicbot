'use strict';
/**
 * Cloudflare Access JWT verification (defense-in-depth on the /kick endpoint).
 * Uses a locally generated RSA keypair to sign tokens, so the test is fully
 * offline — no team JWKS fetch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyAccessJwt, makeAccessVerifier } = require('../lib/access-jwt');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt({ kid, privateKey, payload }) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${b64url(sig)}`;
}

function setup() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-kid';
  return { privateKey, kid, jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] } };
}

test('verifyAccessJwt: accepts a valid token and returns the payload', () => {
  const { privateKey, jwks, kid } = setup();
  const token = signJwt({ kid, privateKey, payload: { aud: ['AUD123'], exp: 9999999999 } });
  const payload = verifyAccessJwt(token, { jwks, aud: 'AUD123', now: 1000 });
  assert.deepEqual(payload.aud, ['AUD123']);
});

test('verifyAccessJwt: rejects an expired token', () => {
  const { privateKey, jwks, kid } = setup();
  const token = signJwt({ kid, privateKey, payload: { aud: ['AUD123'], exp: 500 } });
  assert.throws(() => verifyAccessJwt(token, { jwks, aud: 'AUD123', now: 1000 }), /expired/);
});

test('verifyAccessJwt: rejects a wrong audience', () => {
  const { privateKey, jwks, kid } = setup();
  const token = signJwt({ kid, privateKey, payload: { aud: ['OTHER'], exp: 9999999999 } });
  assert.throws(() => verifyAccessJwt(token, { jwks, aud: 'AUD123', now: 1000 }), /aud/);
});

test('verifyAccessJwt: rejects a tampered signature', () => {
  const { privateKey, jwks, kid } = setup();
  const token = signJwt({ kid, privateKey, payload: { aud: ['AUD123'], exp: 9999999999 } });
  const tampered = `${token.slice(0, -4)}AAAA`;
  assert.throws(() => verifyAccessJwt(tampered, { jwks, aud: 'AUD123', now: 1000 }), /signature/);
});

test('verifyAccessJwt: rejects an unknown kid (no matching JWKS key)', () => {
  const { privateKey, jwks } = setup();
  const token = signJwt({ kid: 'other-kid', privateKey, payload: { aud: ['AUD123'], exp: 9999999999 } });
  assert.throws(() => verifyAccessJwt(token, { jwks, aud: 'AUD123', now: 1000 }), /JWKS|key/);
});

test('makeAccessVerifier: caches JWKS across calls', async () => {
  const { privateKey, jwks, kid } = setup();
  let fetches = 0;
  const verify = makeAccessVerifier({
    teamDomain: 'team.cloudflareaccess.com',
    aud: 'AUD123',
    fetchJwks: async () => { fetches += 1; return jwks; },
    now: () => 1_000_000,
  });
  const token = signJwt({ kid, privateKey, payload: { aud: ['AUD123'], exp: 9999999999 } });
  await verify(token);
  await verify(token);
  assert.equal(fetches, 1);
});
