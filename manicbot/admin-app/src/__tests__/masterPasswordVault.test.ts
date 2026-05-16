import { describe, it, expect } from "vitest";
import {
  encryptMasterPassword,
  decryptMasterPassword,
  MASTER_PASSWORD_LABEL,
} from "~/server/security/masterPasswordVault";

// 32-byte test KEK (NEVER use in production). Same shape as BOT_ENCRYPTION_KEY.
const TEST_KEK = "test-kek-32-chars-minimum-len-xx";
const OTHER_KEK = "another-test-kek-32-chars-min-yy";

describe("masterPasswordVault", () => {
  it("encrypts and decrypts a password round-trip", async () => {
    const blob = await encryptMasterPassword("SuperSecret123!", TEST_KEK);
    expect(blob).toBeTruthy();
    expect(blob!.startsWith("v1$")).toBe(true);
    const plain = await decryptMasterPassword(blob!, TEST_KEK);
    expect(plain).toBe("SuperSecret123!");
  });

  it("returns null when KEK is missing", async () => {
    const blob = await encryptMasterPassword("any", null);
    expect(blob).toBeNull();
  });

  it("returns null when KEK is too short (< 32 chars)", async () => {
    const blob = await encryptMasterPassword("any", "too-short");
    expect(blob).toBeNull();
  });

  it("returns null when plaintext is empty", async () => {
    const blob = await encryptMasterPassword("", TEST_KEK);
    expect(blob).toBeNull();
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV)", async () => {
    const a = await encryptMasterPassword("same", TEST_KEK);
    const b = await encryptMasterPassword("same", TEST_KEK);
    expect(a).not.toBe(b);
  });

  it("decrypt returns null on wrong KEK (HKDF subkey differs)", async () => {
    const blob = await encryptMasterPassword("SuperSecret123!", TEST_KEK);
    const plain = await decryptMasterPassword(blob!, OTHER_KEK);
    expect(plain).toBeNull();
  });

  it("decrypt returns null on tampered ciphertext (AES-GCM tag detects)", async () => {
    const blob = await encryptMasterPassword("SuperSecret123!", TEST_KEK);
    const tampered = blob!.slice(0, -2) + "XX";
    const plain = await decryptMasterPassword(tampered, TEST_KEK);
    expect(plain).toBeNull();
  });

  it("decrypt returns null when blob lacks v1$ prefix (refuses legacy/unknown)", async () => {
    const plain = await decryptMasterPassword("rawbase64data", TEST_KEK);
    expect(plain).toBeNull();
  });

  it("MASTER_PASSWORD_LABEL is stable so the Worker can be taught to read this column", () => {
    expect(MASTER_PASSWORD_LABEL).toBe("master-password-v1");
  });
});
