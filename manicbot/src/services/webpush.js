/**
 * Web Push (RFC 8291) sender — Cloudflare Workers / Web Crypto edition.
 *
 * Implements the bits we need:
 *   - Payload encryption: ECDH-P256 → HKDF-SHA256 → AES-128-GCM with the
 *     "aes128gcm" content-encoding (RFC 8188 + RFC 8291).
 *   - VAPID JWT signing with the platform's static P-256 key (Web Crypto
 *     ECDSA-P256-SHA256, raw → JOSE signature concat).
 *   - Single send() that returns the upstream status so the caller can
 *     prune 404 / 410 endpoints.
 *
 * Why custom instead of `web-push` npm: the `web-push` package pulls in
 * Node crypto APIs (no Workers runtime equivalent). The math here is the
 * canonical 80-line implementation in the spec — Workers Web Crypto has
 * everything we need.
 *
 * Inputs assumed base64url-encoded as received from PushManager:
 *   subscription.p256dh : 65-byte uncompressed P-256 point
 *   subscription.auth   : 16-byte secret
 *
 * VAPID private key: base64url-encoded P-256 scalar (32 bytes).
 * VAPID public key:  base64url-encoded uncompressed P-256 point (65 bytes).
 */

const TEXT_ENC = new TextEncoder();

// ── Base64url helpers ───────────────────────────────────────────────────

export function b64uToBytes(str) {
  if (!str) return new Uint8Array(0);
  const pad = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ── ECDH key handling ──────────────────────────────────────────────────

async function importVapidPrivateKey(b64uScalar) {
  // Re-derive the public point in JWK form by exporting from a fresh import
  // of the private scalar. Easiest path: store both keys (we do).
  // Here we just import the private side. Caller passes the public point
  // separately when needed (e.g. JWT header).
  const d = b64uToBytes(b64uScalar);
  if (d.length !== 32) throw new Error("vapid_private_key_invalid_length");
  // SPKI / PKCS8 import requires DER wrapping; jwk is the easy route.
  // We need x + y as JWK fields. The caller must pass them — see
  // importVapidPair below.
  throw new Error("use_importVapidPair");
}

async function importVapidPair(b64uPublic, b64uPrivate) {
  const pub = b64uToBytes(b64uPublic);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("vapid_public_key_invalid");
  }
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const d = b64uToBytes(b64uPrivate);
  if (d.length !== 32) throw new Error("vapid_private_key_invalid");

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64u(x),
    y: bytesToB64u(y),
    d: bytesToB64u(d),
    ext: true,
  };
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function importP256RecipientPublic(p256dhB64u) {
  const pub = b64uToBytes(p256dhB64u);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error("recipient_public_key_invalid");
  }
  return crypto.subtle.importKey(
    "raw",
    pub,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

async function generateEphemeralEcdhKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
}

// ── HKDF ────────────────────────────────────────────────────────────────

async function hkdf(salt, ikm, info, length) {
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    ikmKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── aes128gcm encryption per RFC 8291 ──────────────────────────────────

/**
 * Encrypt `plaintext` (Uint8Array) for the given subscription.
 * Returns the body the push service expects (binary), already prefixed
 * with the aes128gcm record header.
 */
export async function encryptAes128Gcm(plaintext, p256dhB64u, authB64u) {
  const recipientPub = await importP256RecipientPublic(p256dhB64u);
  const ephemeral = await generateEphemeralEcdhKeyPair();

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientPub },
    ephemeral.privateKey,
    256,
  );
  const sharedSecret = new Uint8Array(sharedBits);

  const authSecret = b64uToBytes(authB64u);
  if (authSecret.length !== 16) throw new Error("auth_secret_invalid_length");

  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );
  const recipientPubRaw = b64uToBytes(p256dhB64u);

  // Per RFC 8291 §3.3:
  //   key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = concatBytes(
    TEXT_ENC.encode("WebPush: info\0"),
    recipientPubRaw,
    ephemeralPubRaw,
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // Random salt (16 bytes).
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // CEK + nonce derivation per RFC 8188 (aes128gcm).
  const cekInfo = TEXT_ENC.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = TEXT_ENC.encode("Content-Encoding: nonce\0");
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Pad with 0x02 (last record marker) — single record is fine for our
  // small JSON payloads.
  const padded = concatBytes(plaintext, new Uint8Array([0x02]));

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded),
  );

  // Build the RFC 8188 aes128gcm record:
  //   salt (16) || record_size (4, big-endian) || idlen (1) || keyid (idlen) || ciphertext
  // For Web Push idlen = 65, keyid = ephemeral public point.
  const recordSize = new Uint8Array(4);
  // 4096 is the standard record size — well above our payloads.
  const RECORD_SIZE = 4096;
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE, false);

  const idlen = new Uint8Array([ephemeralPubRaw.length]); // 65
  return concatBytes(salt, recordSize, idlen, ephemeralPubRaw, ciphertext);
}

// ── VAPID JWT ──────────────────────────────────────────────────────────

function urlOrigin(endpoint) {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

/**
 * Build + sign the VAPID JWT (ES256). `subject` should be a `mailto:` URL.
 */
export async function buildVapidAuthHeader(endpoint, subject, publicKeyB64u, privateKeyB64u) {
  const header = { typ: "JWT", alg: "ES256" };
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12 hours
  const payload = { aud: urlOrigin(endpoint), exp, sub: subject };

  const headerB64 = bytesToB64u(TEXT_ENC.encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64u(TEXT_ENC.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importVapidPair(publicKeyB64u, privateKeyB64u);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: { name: "SHA-256" } },
      key,
      TEXT_ENC.encode(signingInput),
    ),
  );
  const jwt = `${signingInput}.${bytesToB64u(signature)}`;
  return {
    authorization: `vapid t=${jwt}, k=${publicKeyB64u}`,
  };
}

// ── send() — the single function callers use ───────────────────────────

/**
 * Send a Web Push notification.
 *
 * @param {object} subscription { endpoint, p256dh, auth }
 * @param {object|Uint8Array|string} payload — JSON-serializable or raw bytes
 * @param {object} vapid { subject, publicKey, privateKey } (base64url)
 * @param {object} [opts] { ttl?: number, urgency?: 'very-low'|'low'|'normal'|'high', topic?: string }
 * @returns {Promise<{ ok: boolean, status: number, body?: string }>}
 */
export async function sendWebPush(subscription, payload, vapid, opts = {}) {
  if (!subscription?.endpoint) return { ok: false, status: 0, body: "missing_endpoint" };
  if (!vapid?.publicKey || !vapid?.privateKey || !vapid?.subject) {
    return { ok: false, status: 0, body: "missing_vapid_config" };
  }

  let plain;
  if (payload instanceof Uint8Array) plain = payload;
  else if (typeof payload === "string") plain = TEXT_ENC.encode(payload);
  else plain = TEXT_ENC.encode(JSON.stringify(payload ?? {}));

  const body = await encryptAes128Gcm(plain, subscription.p256dh, subscription.auth);
  const auth = await buildVapidAuthHeader(
    subscription.endpoint,
    vapid.subject,
    vapid.publicKey,
    vapid.privateKey,
  );

  const headers = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    "Content-Length": String(body.length),
    "TTL": String(Math.max(0, Math.min(opts.ttl ?? 86400, 60 * 60 * 24 * 28))),
    "Authorization": auth.authorization,
  };
  if (opts.urgency) headers["Urgency"] = opts.urgency;
  if (opts.topic) headers["Topic"] = String(opts.topic).slice(0, 32);

  try {
    const resp = await fetch(subscription.endpoint, {
      method: "POST",
      headers,
      body,
    });
    const status = resp.status;
    if (status >= 200 && status < 300) return { ok: true, status };
    // 404 / 410 → subscription gone; caller should prune.
    const text = await resp.text().catch(() => "");
    return { ok: false, status, body: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 0, body: String(e?.message ?? "fetch_failed").slice(0, 500) };
  }
}
