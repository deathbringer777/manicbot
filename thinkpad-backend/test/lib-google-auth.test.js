'use strict';
/**
 * lib/google-auth.js — service-account → OAuth2 access token for Google APIs.
 * Hand-rolled RS256 JWT (no googleapis/google-auth-library dependency) so the
 * token exchange stays on the existing injectable-transport test seam.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createGoogleAuth } = require('../lib/google-auth');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const FIXED_NOW = 1_700_000_000_000; // deterministic iat/exp

function testKeypair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function fakeTokenTransport(data = { access_token: 'ya29.test', expires_in: 3600, token_type: 'Bearer' }, status = 200) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { status, data }; };
  fn.calls = calls;
  return fn;
}

function decodeJwt(assertion) {
  const [h, c, sig] = assertion.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(c, 'base64url').toString()),
    signingInput: `${h}.${c}`,
    signature: sig,
  };
}

test('getAccessToken exchanges a signed JWT and returns the token', async () => {
  const { publicKey, privateKey } = testKeypair();
  const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: privateKey };
  const transport = fakeTokenTransport();
  const auth = createGoogleAuth({ serviceAccountJson: sa, scope: SCOPE, now: () => FIXED_NOW, transport });

  const token = await auth.getAccessToken();
  assert.equal(token, 'ya29.test');
  assert.equal(transport.calls.length, 1);

  const { url, opts } = transport.calls[0];
  assert.equal(url, TOKEN_URL);
  assert.equal(opts.method, 'POST');
  assert.match(opts.headers['Content-Type'], /application\/x-www-form-urlencoded/);
  assert.equal(typeof opts.body, 'string');

  const params = new URLSearchParams(opts.body);
  assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const { header, claims, signingInput, signature } = decodeJwt(params.get('assertion'));
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.scope, SCOPE);
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.iat, Math.floor(FIXED_NOW / 1000));
  assert.equal(claims.exp, claims.iat + 3600);

  const verified = crypto.createVerify('RSA-SHA256')
    .update(signingInput)
    .verify(publicKey, Buffer.from(signature, 'base64url'));
  assert.equal(verified, true, 'JWT signature must verify against the SA public key');
});

test('getAccessToken caches the token until it nears expiry', async () => {
  const { privateKey } = testKeypair();
  const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: privateKey };
  const transport = fakeTokenTransport();
  let clock = FIXED_NOW;
  const auth = createGoogleAuth({ serviceAccountJson: sa, scope: SCOPE, now: () => clock, transport });

  await auth.getAccessToken();
  await auth.getAccessToken();           // still valid → no new exchange
  assert.equal(transport.calls.length, 1);

  clock += 3600 * 1000;                  // past expiry → refresh
  await auth.getAccessToken();
  assert.equal(transport.calls.length, 2);
});

test('getAccessToken throws on a service account missing its private key', async () => {
  const auth = createGoogleAuth({ serviceAccountJson: { client_email: 'x' }, scope: SCOPE });
  await assert.rejects(() => auth.getAccessToken(), /private_key|client_email/i);
});

test('getAccessToken surfaces an OAuth error response', async () => {
  const { privateKey } = testKeypair();
  const sa = { client_email: 'svc@proj.iam.gserviceaccount.com', private_key: privateKey };
  const transport = fakeTokenTransport({ error: 'invalid_grant', error_description: 'bad signature' }, 400);
  const auth = createGoogleAuth({ serviceAccountJson: sa, scope: SCOPE, now: () => FIXED_NOW, transport });
  await assert.rejects(() => auth.getAccessToken(), /invalid_grant|bad signature/);
});
