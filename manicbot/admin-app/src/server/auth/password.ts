/**
 * Edge-compatible password hashing using PBKDF2 (Web Crypto API).
 * Works in Cloudflare Workers / Next.js edge runtime.
 *
 * Hash format (v2): `pbkdf2:{iterations}:{saltHex}:{hashHex}`
 * Legacy format  (v1): `pbkdf2:{saltHex}:{hashHex}` — parsed with implicit 100k iterations.
 *
 * Cloudflare Workers / Pages edge runtime caps PBKDF2 iterations at 100,000.
 * We use the maximum allowed value. Legacy v1 hashes (3-part format) are still
 * accepted on verify and no longer trigger rehash since they already use 100k.
 */

const ALGO = "pbkdf2";
const DEFAULT_ITERATIONS = 100_000;
const LEGACY_ITERATIONS = 100_000;
const KEY_LEN_BITS = 256;

function hexEncode(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexDecode(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LEN_BITS,
  );
  return hexEncode(bits);
}

/** Hash a plaintext password. Returns a storable `pbkdf2:{iterations}:{saltHex}:{hashHex}` string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, salt, DEFAULT_ITERATIONS);
  return `${ALGO}:${DEFAULT_ITERATIONS}:${hexEncode(salt.buffer)}:${hash}`;
}

/**
 * Parse a stored PBKDF2 hash (v1 or v2 format).
 * Returns null for unknown formats.
 */
function parseStored(stored: string): { iterations: number; saltHex: string; hash: string } | null {
  const parts = stored.split(":");
  if (parts[0] !== ALGO) return null;
  // v2: pbkdf2:iter:salt:hash
  if (parts.length === 4) {
    const iter = parseInt(parts[1]!, 10);
    if (!Number.isFinite(iter) || iter < 10_000) return null;
    return { iterations: iter, saltHex: parts[2]!, hash: parts[3]! };
  }
  // v1 (legacy): pbkdf2:salt:hash — assume 100k iterations
  if (parts.length === 3) {
    return { iterations: LEGACY_ITERATIONS, saltHex: parts[1]!, hash: parts[2]! };
  }
  return null;
}

/** Verify a plaintext password against a stored hash. Constant-time comparison. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const salt = hexDecode(parsed.saltHex);
  const computed = await deriveKey(password, salt, parsed.iterations);
  // Constant-time comparison
  if (computed.length !== parsed.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ parsed.hash.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns true if the stored hash uses outdated parameters (legacy iterations
 * or v1 format) and should be re-hashed on next successful login.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return true;
  return parsed.iterations < DEFAULT_ITERATIONS;
}
