/**
 * Master password vault — reversibly-encrypted plaintext password storage for
 * salon-owned master accounts (origin='salon_created').
 *
 * Why reversible (vs PBKDF2-only):
 *   Per product requirement: when a salon creates a master account itself,
 *   the salon is the credential owner. The salon owner must be able to peek
 *   at the password (under OTP gate) and rotate it. Hashed passwords cannot
 *   be displayed; this column stores an AES-GCM-encrypted copy of the
 *   plaintext so the salon can recover it on demand.
 *
 * Format mirror with manicbot/src/utils/security.js:
 *   `v1$` + base64(iv ‖ ciphertext+tag), AES-GCM, HKDF-SHA256 subkey derived
 *   from BOT_ENCRYPTION_KEY with label 'master-password-v1'. The salt
 *   ('manicbot-v1') and IV length (12) match the Worker, so a future port
 *   that needs to decrypt server-side would just call `decryptToken(blob,
 *   key, 'master-password-v1')` from the Worker security helper.
 *
 * Trust domain isolation:
 *   The HKDF label is unique to this use-case. A leak of any other-domain
 *   ciphertext (channel-token, google-refresh, etc.) under the same root key
 *   does not give an attacker a working key against master-password blobs,
 *   and vice versa.
 *
 * Security trade-off:
 *   Reversible storage is meaningfully weaker than one-way hashing. The
 *   `password_hash` column on web_users still holds the PBKDF2 hash and
 *   remains the only thing used for authentication. The encrypted plaintext
 *   in `password_encrypted` is auxiliary — only read by salon.peekMasterPassword
 *   under OTP gate, never used to log anyone in. If BOT_ENCRYPTION_KEY leaks,
 *   passwords stored here become recoverable; the rotation runbook in
 *   /admin/rotate-encryption-key covers this column.
 *
 *   Only salon_created masters have a non-NULL value here. Masters who own
 *   their own credentials never have a recoverable copy.
 */

const ALGO = "AES-GCM";
const IV_LEN = 12;
const TAG_LEN = 128;
const HKDF_SALT = new TextEncoder().encode("manicbot-v1");
const VERSION_PREFIX = "v1$";

/** HKDF label — must match the Worker if/when it reads this column. */
export const MASTER_PASSWORD_LABEL = "master-password-v1";

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

async function aesGcmEncrypt(plain: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: ALGO, iv, tagLength: TAG_LEN },
    key,
    new TextEncoder().encode(plain),
  );
  const buf = new Uint8Array(iv.length + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...buf));
}

async function aesGcmDecrypt(b64: string, key: CryptoKey): Promise<string> {
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const iv = buf.slice(0, IV_LEN);
  const data = buf.slice(IV_LEN);
  const pt = await crypto.subtle.decrypt(
    { name: ALGO, iv, tagLength: TAG_LEN },
    key,
    data,
  );
  return new TextDecoder().decode(pt);
}

/**
 * Encrypt a plaintext password for storage in web_users.password_encrypted.
 *
 * Fail-closed contract: returns `null` when the master key is missing or too
 * short. Callers must NOT silently store plaintext on null return — instead,
 * refuse the operation and surface a configuration error so the operator
 * notices.
 *
 * @param plain      raw plaintext password
 * @param masterKey  BOT_ENCRYPTION_KEY env value
 * @returns          ciphertext starting with `v1$`, or `null` on misconfig
 */
export async function encryptMasterPassword(
  plain: string,
  masterKey: string | undefined | null,
): Promise<string | null> {
  if (!masterKey || masterKey.length < 32) return null;
  if (!plain) return null;
  const key = await deriveSubkey(masterKey, MASTER_PASSWORD_LABEL);
  return VERSION_PREFIX + (await aesGcmEncrypt(plain, key));
}

/**
 * Decrypt a stored ciphertext back into the plaintext password.
 *
 * Returns `null` on any error (wrong key, malformed blob, tampered tag) so
 * callers can surface a generic "cannot decrypt" message without leaking
 * crypto details.
 */
export async function decryptMasterPassword(
  blob: string,
  masterKey: string | undefined | null,
): Promise<string | null> {
  if (!masterKey || masterKey.length < 32) return null;
  if (!blob || !blob.startsWith(VERSION_PREFIX)) return null;
  try {
    const key = await deriveSubkey(masterKey, MASTER_PASSWORD_LABEL);
    return await aesGcmDecrypt(blob.slice(VERSION_PREFIX.length), key);
  } catch {
    return null;
  }
}
