import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "~/server/auth/password";

describe("password hashing (PBKDF2)", () => {
  it("hashPassword returns pbkdf2:{salt}:{hash} format", async () => {
    const hashed = await hashPassword("TestPassword123!");
    const parts = hashed.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("pbkdf2");
    // salt = 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // hash = 256 bits = 32 bytes = 64 hex chars
    expect(parts[2]).toHaveLength(64);
  });

  it("different calls produce different salts", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    const salt1 = h1.split(":")[1];
    const salt2 = h2.split(":")[1];
    expect(salt1).not.toBe(salt2);
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
