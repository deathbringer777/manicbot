/**
 * Short-lived signed blob for Google OAuth → web registration prefill (Edge-safe Web Crypto).
 * Format: base64url(payloadJson).base64url(hmacSha256(payloadBytes))
 */

export type GooglePrefillPayload = {
  email: string;
  name: string | null;
  sub: string;
  exp: number;
};

function uint8ToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toBase64Url(buf: ArrayBuffer): string {
  return uint8ToBase64Url(new Uint8Array(buf));
}

function fromBase64Url(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, message: Uint8Array): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, message as BufferSource);
}

/** Default TTL for prefill token (seconds). */
export const GOOGLE_PREFILL_TTL_SEC = 15 * 60;

export async function signGooglePrefillToken(
  secret: string,
  input: { email: string; name: string | null; sub: string; ttlSec?: number },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: GooglePrefillPayload = {
    email: input.email.toLowerCase().trim(),
    name: input.name?.trim() ? input.name.trim() : null,
    sub: input.sub,
    exp: now + (input.ttlSec ?? GOOGLE_PREFILL_TTL_SEC),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const sig = await hmacSha256(secret, payloadBytes);
  return `${uint8ToBase64Url(payloadBytes)}.${toBase64Url(sig)}`;
}

export async function verifyGooglePrefillToken(
  secret: string,
  token: string,
): Promise<GooglePrefillPayload | null> {
  const trimmed = token.trim();
  if (!trimmed || !secret) return null;
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadPart = trimmed.slice(0, dot);
  const sigPart = trimmed.slice(dot + 1);
  if (!payloadPart || !sigPart) return null;
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(payloadPart);
  } catch {
    return null;
  }
  let expectedSig: Uint8Array;
  try {
    expectedSig = fromBase64Url(sigPart);
  } catch {
    return null;
  }
  const computed = new Uint8Array(await hmacSha256(secret, payloadBytes));
  if (expectedSig.length !== computed.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig[i]! ^ computed[i]!;
  }
  if (diff !== 0) return null;

  let payload: GooglePrefillPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as GooglePrefillPayload;
  } catch {
    return null;
  }
  if (
    typeof payload.email !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.name != null && typeof payload.name !== "string") return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return null;
  return {
    email: payload.email.toLowerCase().trim(),
    name: payload.name?.trim() ? payload.name.trim() : null,
    sub: payload.sub,
    exp: payload.exp,
  };
}
