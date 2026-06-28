'use strict';
/**
 * Cloudflare Access JWT verification for the /kick endpoint (defense-in-depth).
 *
 * The Worker calls jobs.manicbot.com/kick with an Access service token;
 * Cloudflare Access validates it at the edge and forwards a signed JWT in the
 * `Cf-Access-Jwt-Assertion` header. The sidecar verifies that JWT (RS256 against
 * the team JWKS + expected AUD) so a request that reaches the origin without a
 * valid Access context (e.g. a process already on the box) is still rejected.
 *
 * No external deps — node:crypto does RS256 over the team's public JWKS.
 */
const crypto = require('crypto');
const { httpJson } = require('./http');

const JWKS_TTL_MS = 60 * 60 * 1000; // 1h — Access rotates signing keys slowly

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function decodeSegment(s) {
  return JSON.parse(b64urlToBuf(s).toString('utf8'));
}

/**
 * Verify a Cloudflare Access JWT. Returns the decoded payload, or throws.
 * @param {string} token - the Cf-Access-Jwt-Assertion value.
 * @param {{ jwks: object, aud: string, now?: number }} opts - team JWKS, expected
 *   AUD tag, current epoch SECONDS (injected in tests).
 */
function verifyAccessJwt(token, { jwks, aud, now = Math.floor(Date.now() / 1000) }) {
  if (!token || typeof token !== 'string') throw new Error('access: missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('access: malformed token');
  const [h, p, sig] = parts;

  let header;
  try { header = decodeSegment(h); } catch { throw new Error('access: malformed header'); }
  if (header.alg !== 'RS256') throw new Error(`access: unexpected alg ${header.alg}`);

  const key = (jwks?.keys || []).find((k) => k.kid === header.kid);
  if (!key) throw new Error('access: no matching JWKS key for kid');

  const pub = crypto.createPublicKey({ key, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, b64urlToBuf(sig));
  if (!ok) throw new Error('access: bad signature');

  let payload;
  try { payload = decodeSegment(p); } catch { throw new Error('access: malformed payload'); }
  // SEC-003: require exp and aud — do NOT "check only if present". A token without
  // exp would never expire (eternal replay); an unconfigured aud would accept any
  // token the team's Access ever issues for any other app (JWKS is team-wide).
  if (typeof payload.exp !== 'number') throw new Error('access: token missing exp');
  if (now >= payload.exp) throw new Error('access: token expired');
  if (!aud) throw new Error('access: verifier misconfigured (no expected aud)');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('access: aud mismatch');
  return payload;
}

async function defaultFetchJwks(teamDomain) {
  const res = await httpJson(`https://${teamDomain}/cdn-cgi/access/certs`, { timeoutMs: 10000 });
  if (res.status !== 200 || !res.data?.keys) {
    throw new Error(`access: JWKS fetch failed (status ${res?.status})`);
  }
  return res.data;
}

/**
 * Build a verifier that fetches + caches the team JWKS. Returns
 * `verify(token) => Promise<payload>` (throws on any failure).
 */
function makeAccessVerifier({ teamDomain, aud, fetchJwks = defaultFetchJwks, ttlMs = JWKS_TTL_MS, now = () => Date.now() }) {
  let cache = null;
  let cachedAt = 0;
  async function getJwks() {
    if (cache && now() - cachedAt < ttlMs) return cache;
    cache = await fetchJwks(teamDomain);
    cachedAt = now();
    return cache;
  }
  return async function verify(token) {
    const jwks = await getJwks();
    return verifyAccessJwt(token, { jwks, aud, now: Math.floor(now() / 1000) });
  };
}

module.exports = { verifyAccessJwt, makeAccessVerifier, defaultFetchJwks };
