/**
 * Edge-compatible password hashing using PBKDF2 (Web Crypto API).
 * Works in Cloudflare Workers / Next.js edge runtime.
 */

const ALGO = "pbkdf2";
const ITERATIONS = 310_000;
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

async function deriveKey(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    KEY_LEN_BITS,
  );
  return hexEncode(bits);
}

/** Hash a plaintext password. Returns a storable `pbkdf2:{saltHex}:{hashHex}` string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveKey(password, salt);
  return `${ALGO}:${hexEncode(salt.buffer)}:${hash}`;
}

/** Verify a plaintext password against a stored hash. Constant-time comparison. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== ALGO) return false;
  const [, saltHex, storedHash] = parts as [string, string, string];
  const salt = hexDecode(saltHex);
  const computed = await deriveKey(password, salt);
  // Constant-time comparison
  if (computed.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
