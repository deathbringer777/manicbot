/**
 * Type declarations for the Worker-side upload token module.
 *
 * These declarations allow the admin-app TypeScript project to import
 * `verifyUploadToken` in tests without pulling in the Worker JS files
 * and all their transitive un-annotated dependencies.
 *
 * Keep in sync with `upload.js` public API.
 */

export declare const ALLOWED_KINDS: Set<string>;
export declare const ALLOWED_MIME: Map<string, string>;
export declare const MAX_UPLOAD_BYTES: number;
export declare const DEFAULT_TOKEN_TTL_SEC: number;

/**
 * Payload shape returned by `verifyUploadToken`.
 * `uid` is the web_users.id embedded for audit trail; null for legacy tokens.
 */
export interface UploadTokenPayload {
  tid: string;
  kind: string;
  exp: number;
  uid: string | null;
}

/**
 * Mint a short-lived HMAC-signed upload token.
 *
 * @param params.tid      tenant id
 * @param params.kind     one of ALLOWED_KINDS
 * @param params.secret   UPLOAD_TOKEN_SECRET (≥16 chars)
 * @param params.ttlSec   default 300s
 * @param params.uid      optional web_users.id for audit trail
 */
export declare function signUploadToken(params: {
  tid: string;
  kind: string;
  secret: string;
  ttlSec?: number;
  uid?: string;
}): Promise<string>;

/**
 * Verify a signed upload token. Returns the parsed payload on success,
 * or null on any error (malformed, bad signature, expired, unknown kind).
 */
export declare function verifyUploadToken(
  token: string,
  secret: string,
): Promise<UploadTokenPayload | null>;

/** Content-addressed R2 key: `t/{tid}/{kind}-{sha12}.{ext}`. */
export declare function buildAssetKey(
  tid: string,
  kind: string,
  bytes: Uint8Array,
  ext: string,
): Promise<string>;

export declare function sha256Hex(bytes: Uint8Array): Promise<string>;
