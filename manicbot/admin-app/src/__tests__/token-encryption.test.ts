/**
 * #H3 (SECURITY_FINDINGS v3 §HIGH) — admin-app must produce ciphertexts that
 * the Worker's `decryptToken(label='bot-token-v1')` can decrypt. Without this
 * helper, the new `connectBot` flow inserts a `bots` row with NULL
 * `token_encrypted` and the Worker's `getBotToken` returns null at runtime —
 * the bot silently fails to receive webhooks.
 *
 * This test:
 *   1. Encrypts with the admin-app helper.
 *   2. Decrypts with a JS port of the Worker decryptor (kept inline here).
 *   3. Asserts roundtrip + format (`v1$` prefix) + label-isolation.
 */
import { describe, it, expect } from "vitest";
import { encryptBotTokenForWorker } from "~/server/security/tokenEncryption";

const BOT_TOKEN_LABEL = "bot-token-v1";
const HKDF_SALT = new TextEncoder().encode("manicbot-v1");
const VERSION_PREFIX = "v1$";

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
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function decryptWorkerCompat(encrypted: string, masterKey: string, label: string): Promise<string | null> {
  if (!encrypted.startsWith(VERSION_PREFIX)) return null;
  try {
    const key = await deriveSubkey(masterKey, label);
    const buf = Uint8Array.from(atob(encrypted.slice(VERSION_PREFIX.length)), (c) => c.charCodeAt(0));
    const iv = buf.slice(0, 12);
    const data = buf.slice(12);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, data);
    return new TextDecoder().decode(dec);
  } catch {
    return null;
  }
}

describe("encryptBotTokenForWorker (#H3)", () => {
  const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef"; // 48 chars, well above 32

  it("produces a `v1$` HKDF-prefixed ciphertext", async () => {
    const enc = await encryptBotTokenForWorker("123456:ABCDEF_test_token", KEY);
    expect(enc).toBeTruthy();
    expect(enc!.startsWith(VERSION_PREFIX)).toBe(true);
  });

  it("ciphertext decrypts back to the original via Worker-compatible decryptor", async () => {
    const plain = "987654321:XYZ_real_looking_token_blob";
    const enc = await encryptBotTokenForWorker(plain, KEY);
    const decrypted = await decryptWorkerCompat(enc!, KEY, BOT_TOKEN_LABEL);
    expect(decrypted).toBe(plain);
  });

  it("decrypt with the wrong label fails (HKDF domain isolation)", async () => {
    const plain = "999:abc";
    const enc = await encryptBotTokenForWorker(plain, KEY);
    const wrong = await decryptWorkerCompat(enc!, KEY, "channel-token-v1");
    expect(wrong).toBeNull();
  });

  it("decrypt with the wrong key fails", async () => {
    const plain = "999:abc";
    const enc = await encryptBotTokenForWorker(plain, KEY);
    const wrongKey = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const wrong = await decryptWorkerCompat(enc!, wrongKey, BOT_TOKEN_LABEL);
    expect(wrong).toBeNull();
  });

  it("returns null when the master key is too short (security guard)", async () => {
    const enc = await encryptBotTokenForWorker("token", "short");
    expect(enc).toBeNull();
  });

  it("returns null when the master key is unset", async () => {
    const enc = await encryptBotTokenForWorker("token", "");
    expect(enc).toBeNull();
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", async () => {
    const plain = "same:token";
    const a = await encryptBotTokenForWorker(plain, KEY);
    const b = await encryptBotTokenForWorker(plain, KEY);
    expect(a).not.toBe(b);
    // But both decrypt to the same plaintext.
    expect(await decryptWorkerCompat(a!, KEY, BOT_TOKEN_LABEL)).toBe(plain);
    expect(await decryptWorkerCompat(b!, KEY, BOT_TOKEN_LABEL)).toBe(plain);
  });
});
