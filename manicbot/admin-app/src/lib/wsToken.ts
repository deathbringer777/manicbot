/**
 * Admin-app mirror of `manicbot/src/utils/wsToken.js`. Same format, same
 * algorithm — the Worker verifies tokens minted here on /ws/messenger
 * upgrade.
 *
 * Token format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`
 *
 * Edge-compatible: uses Web Crypto, no Node deps.
 */

const encoder = new TextEncoder();

function base64urlEncode(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === "string"
    ? encoder.encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function mintWsToken(
  secret: string,
  claims: { tenantId: string; webUserId: string },
  ttlSec = 60,
): Promise<string> {
  if (!secret) throw new Error("WS_TOKEN_SECRET not set");
  const ttl = Math.max(1, Math.min(60, ttlSec | 0));
  const payload = {
    tenantId: claims.tenantId,
    webUserId: claims.webUserId,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const payloadEnc = base64urlEncode(JSON.stringify(payload));
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadEnc));
  return `${payloadEnc}.${base64urlEncode(sig)}`;
}
