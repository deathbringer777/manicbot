/**
 * Mint HMAC-signed upload tokens for the Worker's /upload/asset endpoint.
 *
 * Mirror of `manicbot/src/services/upload.js` (the Worker-side verifier) —
 * token format must stay in lockstep between both files.
 *
 * Token format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 * Payload:       { tid, kind, exp, uid? }   (exp = unix seconds; uid = web_users.id of the requester)
 *
 * Must be called from a trusted server context (tRPC mutation) after
 * verifying the caller owns the tenant. Uses Web Crypto — edge-runtime safe.
 *
 * Security model: the tRPC procedure verifies the caller (tenant ownership /
 * thread membership / ticket access) before minting. The token itself IS the
 * auth credential when redeemed at the Worker — single-use is enforced by the
 * 5-minute TTL. The `uid` field binds the token to the minting web user so
 * the Worker can log it in the audit trail; defense-in-depth, not the primary
 * guard.
 */

export type UploadKind = "logo" | "cover" | "photo" | "portfolio" | "service_photo" | "client_avatar" | "master_avatar" | "chat_attachment" | "blog_cover" | "blog_photo" | "cancellation_feedback";

const ALLOWED_KINDS: ReadonlySet<UploadKind> = new Set([
  "logo",
  "cover",
  "photo",
  "portfolio",
  "service_photo",
  "client_avatar",
  "master_avatar",
  "chat_attachment",
  "blog_cover",
  "blog_photo",
  "cancellation_feedback",
]);

const DEFAULT_TTL_SEC = 300; // 5 minutes

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeString(str: string): string {
  return b64urlEncodeBytes(new TextEncoder().encode(str));
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export interface SignUploadTokenParams {
  tid: string;
  kind: UploadKind;
  secret: string;
  ttlSec?: number;
  /** web_users.id of the requesting user — embedded in the payload for audit trail. */
  uid?: string;
}

export async function signUploadToken({
  tid,
  kind,
  secret,
  ttlSec = DEFAULT_TTL_SEC,
  uid,
}: SignUploadTokenParams): Promise<string> {
  if (!tid) throw new Error("tid required");
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`invalid kind: ${kind}`);
  if (!secret || secret.length < 16) {
    throw new Error("UPLOAD_TOKEN_SECRET missing or too short (>= 16 chars)");
  }
  const payload: { tid: string; kind: UploadKind; exp: number; uid?: string } = {
    tid,
    kind,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  if (uid) payload.uid = uid;
  const payloadB64 = b64urlEncodeString(JSON.stringify(payload));
  const sig = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${b64urlEncodeBytes(sig)}`;
}
