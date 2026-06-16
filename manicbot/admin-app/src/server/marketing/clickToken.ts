/**
 * Admin-app twin of the Worker `services/marketing/clickToken.js`.
 *
 * Produces BYTE-IDENTICAL signed click tokens (same fixed payload key order
 * `{c,s,t,ct,u,exp}`, same base64url + HMAC-SHA256) so the Worker `/r/`
 * endpoint verifies tokens minted by the admin-app inline send path with the
 * same `CLICK_TOKEN_SECRET`. Admin-app only signs (the Worker verifies), so
 * there is no `verifyClickToken` here.
 */

const encoder = new TextEncoder();

/** Default token lifetime — emails get clicked weeks later. */
export const CLICK_TOKEN_TTL_SEC = 90 * 24 * 60 * 60;

function base64urlEncode(buf: Uint8Array | string): string {
  const bytes = typeof buf === "string" ? encoder.encode(buf) : buf;
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

export interface ClickClaims {
  campaignId: string;
  sendId?: string | null;
  tenantId: string;
  contactId?: number | null;
  url: string;
}

export async function signClickToken(
  secret: string,
  claims: ClickClaims,
  ttlSec: number = CLICK_TOKEN_TTL_SEC,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!secret) throw new Error("signClickToken: CLICK_TOKEN_SECRET not set");
  if (!claims?.campaignId || !claims?.tenantId || !claims?.url) {
    throw new Error("signClickToken: campaignId + tenantId + url required");
  }
  // Fixed key order — must match the Worker twin byte-for-byte.
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
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadEnc));
  return `${payloadEnc}.${base64urlEncode(new Uint8Array(sig))}`;
}
