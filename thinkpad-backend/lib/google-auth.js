'use strict';
/**
 * Google service-account → OAuth2 access token (RS256 JWT bearer flow).
 *
 * Hand-rolled with node:crypto + the shared httpJson rather than pulling in
 * googleapis/google-auth-library: it keeps the ThinkPad dependency surface at
 * three packages and preserves the injectable-transport test seam used across
 * lib/. Read-only Search Console access only — the credential is a service
 * account added as a user on the GSC property, never a write-scoped token.
 */
const crypto = require('crypto');
const { httpJson } = require('./http');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const REFRESH_SKEW_MS = 60 * 1000; // refresh a minute early so a request never races expiry
const TOKEN_TTL_S = 3600;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Build a signed RS256 JWT assertion for the given service account.
 * Exported for direct testing of the claim set.
 */
function buildSignedJwt(serviceAccountJson, { scope, now = Date.now, audience = TOKEN_URL }) {
  const { client_email: clientEmail, private_key: privateKey } = serviceAccountJson || {};
  if (!clientEmail || !privateKey) {
    throw new Error('Invalid service account JSON: client_email and private_key are required');
  }
  const iat = Math.floor(now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope,
    aud: audience,
    iat,
    exp: iat + TOKEN_TTL_S,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

/**
 * createGoogleAuth — returns { getAccessToken } with an in-process token cache.
 * Inject `now` and `transport` for tests.
 */
function createGoogleAuth({ serviceAccountJson, scope, now = Date.now, transport = httpJson } = {}) {
  let cached = null; // { token, expiresAt }

  async function getAccessToken() {
    if (cached && now() < cached.expiresAt - REFRESH_SKEW_MS) {
      return cached.token;
    }
    const assertion = buildSignedJwt(serviceAccountJson, { scope, now });
    const body = new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString();
    const res = await transport(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      timeoutMs: 15000,
    });
    const data = res?.data || {};
    if (res?.status >= 400 || !data.access_token) {
      const detail = data.error_description || data.error || res?.body || `status ${res?.status}`;
      throw new Error(`Google token exchange failed: ${detail}`);
    }
    const ttlMs = (Number(data.expires_in) || TOKEN_TTL_S) * 1000;
    cached = { token: data.access_token, expiresAt: now() + ttlMs };
    return cached.token;
  }

  return { getAccessToken };
}

module.exports = { createGoogleAuth, buildSignedJwt };
