/**
 * ULID generator (Crockford base32, 26 chars).
 *
 * Format: TTTTTTTTTTRRRRRRRRRRRRRRRR
 *   T (10 chars) — timestamp ms since epoch (48 bits)
 *   R (16 chars) — random (80 bits)
 *
 * Lexicographic order = chronological order, which is what
 * `thread_messages` pagination relies on (cursor on `id`).
 *
 * Edge-compatible: uses `crypto.getRandomValues` (Web Crypto), available
 * in Node 18+, Cloudflare Workers, Pages, and browsers.
 *
 * Worker copy of this util lives at `manicbot/src/utils/ulid.js`. The two
 * MUST stay byte-compatible — a ULID generated in the admin-app and one
 * generated in the Worker need to sort against each other identically.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

function encodeTime(ms: number, len: number): string {
  let out = "";
  let value = ms;
  for (let i = len - 1; i >= 0; i--) {
    const mod = value % 32;
    out = ALPHABET[mod] + out;
    value = (value - mod) / 32;
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i]! % 32];
  }
  return out;
}

export function ulid(timestamp?: number): string {
  const ms = timestamp ?? Date.now();
  return encodeTime(ms, 10) + encodeRandom(16);
}

/** Sanity check used by tests: 26 chars, all Crockford base32. */
export function isUlid(s: string): boolean {
  if (s.length !== 26) return false;
  for (let i = 0; i < 26; i++) {
    if (ALPHABET.indexOf(s[i]!) === -1) return false;
  }
  return true;
}
