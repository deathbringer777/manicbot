/**
 * Worker-compatible token encryption for the admin-app.
 *
 * The Cloudflare Worker decrypts bot tokens via `decryptToken(blob, key, 'bot-token-v1')`
 * (see manicbot/src/utils/security.js). This module produces ciphertexts in the
 * exact same format so admin-app mutations (currently `connectBot`) can write
 * to D1 `bots.token_encrypted` and the Worker can read them back transparently.
 *
 * Format: `v1$` + base64(iv ‖ ciphertext+tag), AES-GCM with HKDF-SHA256 subkey.
 *
 * Why mirror the Worker rather than route through it:
 *   - The admin-app already shares the same D1 instance and runs on the
 *     Cloudflare Pages edge runtime (Web Crypto available).
 *   - Routing through `/admin/provision` would require shipping `ADMIN_KEY`
 *     to the admin-app, widening the secret blast radius.
 *   - HKDF-SHA256 + AES-GCM are deterministic across runtimes, so as long as
 *     `BOT_ENCRYPTION_KEY` matches, both sides agree byte-for-byte.
 */

const ALGO = "AES-GCM";
const IV_LEN = 12;
const TAG_LEN = 128;
const HKDF_SALT = new TextEncoder().encode("manicbot-v1");
const VERSION_PREFIX = "v1$";

/** HKDF label used by Worker bots-table reader. Must match `BOT_TOKEN_LABEL` there. */
export const BOT_TOKEN_LABEL = "bot-token-v1";

async function deriveSubkey(masterKey: string, label: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(masterKey),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: new TextEncoder().encode(label) },
    baseKey,
    256,
  );
  return crypto.subtle.importKey("raw", bits, ALGO, false, ["encrypt", "decrypt"]);
}

async function aesGcmEncryptWithKey(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: ALGO, iv, tagLength: TAG_LEN },
    key,
    new TextEncoder().encode(plain),
  );
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.length);
  // Web-safe base64: keep `+/` (matches atob/btoa default) so the Worker decrypts as-is.
  return btoa(String.fromCharCode(...buf));
}

/**
 * Encrypt a Telegram bot token in the exact format the Worker expects to read
 * back from `bots.token_encrypted`. Returns `null` on misconfiguration so the
 * caller can fail closed (do NOT silently store plaintext).
 *
 * @param plain      raw bot token from the user
 * @param masterKey  `process.env.BOT_ENCRYPTION_KEY` — must be ≥32 chars
 * @returns          ciphertext string starting with `v1$`, or null
 */
export async function encryptBotTokenForWorker(
  plain: string,
  masterKey: string | undefined | null,
): Promise<string | null> {
  if (!masterKey || masterKey.length < 32) return null;
  const key = await deriveSubkey(masterKey, BOT_TOKEN_LABEL);
  return VERSION_PREFIX + (await aesGcmEncryptWithKey(plain, key));
}
