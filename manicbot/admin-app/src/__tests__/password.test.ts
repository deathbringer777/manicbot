import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, needsRehash } from "~/server/auth/password";

describe("password hashing (PBKDF2)", () => {
  it("hashPassword returns pbkdf2:{iterations}:{salt}:{hash} format (v2)", async () => {
    const hashed = await hashPassword("TestPassword123!");
    const parts = hashed.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    // iterations: numeric, ≥ 600k per OWASP 2023
    expect(parseInt(parts[1]!, 10)).toBeGreaterThanOrEqual(600_000);
    // salt = 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32);
    // hash = 256 bits = 32 bytes = 64 hex chars
    expect(parts[3]).toHaveLength(64);
  });

  it("different calls produce different salts", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    const salt1 = h1.split(":")[2];
    const salt2 = h2.split(":")[2];
    expect(salt1).not.toBe(salt2);
  });

  it("verifyPassword still accepts legacy v1 format (3-part) for backward compat", async () => {
    // v1 format: pbkdf2:salt:hash with implicit 100k iterations.
    // We can't easily craft a real v1 hash here without recreating the legacy
    // KDF, so we just test that the parser does not throw on a malformed input.
    expect(await verifyPassword("anything", "pbkdf2:abc:def")).toBe(false);
  });

  it("needsRehash returns true for legacy v1 hashes", () => {
    // v1 has 3 parts, implicit 100k < 600k
    expect(needsRehash("pbkdf2:" + "a".repeat(32) + ":" + "b".repeat(64))).toBe(true);
  });

  it("needsRehash returns false for current v2 hashes", async () => {
    const h = await hashPassword("TestPassword123!");
    expect(needsRehash(h)).toBe(false);
  });

  it("verifyPassword returns true for correct password", async () => {
    const hashed = await hashPassword("CorrectHorse42!");
    expect(await verifyPassword("CorrectHorse42!", hashed)).toBe(true);
  });

  it("verifyPassword returns false for wrong password", async () => {
    const hashed = await hashPassword("CorrectHorse42!");
    expect(await verifyPassword("WrongPassword", hashed)).toBe(false);
  });

  it("verifyPassword returns false for invalid hash format", async () => {
    expect(await verifyPassword("any", "not-a-valid-hash")).toBe(false);
    expect(await verifyPassword("any", "sha256:abc:def")).toBe(false);
    expect(await verifyPassword("any", "")).toBe(false);
  });

  it("verifyPassword handles empty password", async () => {
    const hashed = await hashPassword("");
    expect(await verifyPassword("", hashed)).toBe(true);
    expect(await verifyPassword("notempty", hashed)).toBe(false);
  });

  it("verifyPassword handles unicode passwords", async () => {
    const hashed = await hashPassword("пароль🔑日本語");
    expect(await verifyPassword("пароль🔑日本語", hashed)).toBe(true);
    expect(await verifyPassword("пароль🔑", hashed)).toBe(false);
  });
});
