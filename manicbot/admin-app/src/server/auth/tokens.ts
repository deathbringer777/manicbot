/**
 * Helpers for hashing short-lived auth tokens (password reset, email verification,
 * email change) before storing them in the database.
 *
 * Why hash tokens at rest?
 *   - If the database leaks (backup, SQL injection elsewhere, insider), plaintext
 *     tokens allow full account takeover. Hashed tokens do not.
 *   - Tokens are high-entropy (UUID v4) so plain SHA-256 (no salt) is sufficient
 *     — we don't need slow KDFs like PBKDF2 here.
 *
 * Migration note:
 *   Existing plaintext tokens in DB become invalid after this change. They have
 *   short TTL (password reset: 1h; email verification: 15m; email change: 24h),
 *   so users will just need to request a new token. Acceptable trade-off.
 */

/**
 * Generate a cryptographically-random URL-safe token.
 * Uses `crypto.randomUUID()` which gives ≈122 bits of entropy.
 */
export function generateToken(): string {
  return crypto.randomUUID();
}

/** Hash a token with SHA-256 and return the hex digest. */
export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time comparison of two hex strings. Used to verify a user-supplied
 * token against a stored hash.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
