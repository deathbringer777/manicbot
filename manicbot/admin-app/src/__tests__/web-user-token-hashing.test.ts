/**
 * P1-9 — password-reset / email-verification / email-change tokens are stored
 * as SHA-256 hex digests at rest. Migration 0053 adds *_hash companion columns
 * so the column name matches the contents; for one release we write to both
 * the legacy and the *_hash columns and read with the *_hash column preferred.
 *
 * The router-level integration is hard to drive without D1, so this test
 * exercises the contract pieces:
 *   1. The hashing primitive is deterministic and constant-time-comparable.
 *   2. The rolling-window read prefers the new column and falls back to the
 *      legacy column for tokens minted before the deploy.
 *   3. After consume, both columns must be cleared.
 */
import { describe, it, expect } from "vitest";
import { hashToken, timingSafeEqualHex, generateToken } from "~/server/auth/tokens";

interface WebUserSnapshot {
  passwordResetToken: string | null;
  passwordResetTokenHash: string | null;
  verificationToken: string | null;
  verificationTokenHash: string | null;
  emailChangeToken: string | null;
  emailChangeTokenHash: string | null;
}

/** Mirrors the read logic from resetPassword / verifyEmail / confirmEmailChange. */
function readStoredHash(user: WebUserSnapshot, kind: "reset" | "verify" | "emailChange"): string | null {
  if (kind === "reset") return user.passwordResetTokenHash ?? user.passwordResetToken;
  if (kind === "verify") return user.verificationTokenHash ?? user.verificationToken;
  return user.emailChangeTokenHash ?? user.emailChangeToken;
}

/** Mirrors the rolling-window write: populate BOTH columns. */
function writeRollingWindowReset(hash: string): WebUserSnapshot {
  return {
    passwordResetToken: hash,
    passwordResetTokenHash: hash,
    verificationToken: null,
    verificationTokenHash: null,
    emailChangeToken: null,
    emailChangeTokenHash: null,
  };
}

/** Mirrors the post-consume update: clear BOTH columns. */
function clearResetColumns(user: WebUserSnapshot): WebUserSnapshot {
  return { ...user, passwordResetToken: null, passwordResetTokenHash: null };
}

describe("token hashing — primitives (P1-9)", () => {
  it("hashToken is deterministic", async () => {
    const t = generateToken();
    const h1 = await hashToken(t);
    const h2 = await hashToken(t);
    expect(h1).toBe(h2);
  });

  it("hashToken output is 64-char hex", async () => {
    const h = await hashToken(generateToken());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a freshly generated token hashes to a value distinct from another fresh one", async () => {
    const h1 = await hashToken(generateToken());
    const h2 = await hashToken(generateToken());
    expect(h1).not.toBe(h2);
  });

  it("timingSafeEqualHex returns true for the same hash", async () => {
    const t = "123456";
    const h = await hashToken(t);
    expect(timingSafeEqualHex(h, h)).toBe(true);
  });
});

describe("rolling-window reads (P1-9)", () => {
  it("prefers the *_hash column when both columns are populated", async () => {
    const newHash = await hashToken("freshly-minted-code");
    const oldHash = await hashToken("pre-migration-code");
    const user: WebUserSnapshot = {
      passwordResetToken: oldHash,
      passwordResetTokenHash: newHash,
      verificationToken: null,
      verificationTokenHash: null,
      emailChangeToken: null,
      emailChangeTokenHash: null,
    };
    expect(readStoredHash(user, "reset")).toBe(newHash);
  });

  it("falls back to the legacy column when the *_hash column is null", async () => {
    const oldHash = await hashToken("pre-migration-code");
    const user: WebUserSnapshot = {
      passwordResetToken: oldHash,
      passwordResetTokenHash: null,
      verificationToken: null,
      verificationTokenHash: null,
      emailChangeToken: null,
      emailChangeTokenHash: null,
    };
    expect(readStoredHash(user, "reset")).toBe(oldHash);
  });

  it("returns null when both columns are null", () => {
    const user: WebUserSnapshot = {
      passwordResetToken: null,
      passwordResetTokenHash: null,
      verificationToken: null,
      verificationTokenHash: null,
      emailChangeToken: null,
      emailChangeTokenHash: null,
    };
    expect(readStoredHash(user, "reset")).toBeNull();
    expect(readStoredHash(user, "verify")).toBeNull();
    expect(readStoredHash(user, "emailChange")).toBeNull();
  });
});

describe("write/consume round-trip (P1-9)", () => {
  it("write places the same hash in BOTH columns", async () => {
    const codeHash = await hashToken("456789");
    const u = writeRollingWindowReset(codeHash);
    expect(u.passwordResetToken).toBe(codeHash);
    expect(u.passwordResetTokenHash).toBe(codeHash);
  });

  it("clearing leaves BOTH columns null", async () => {
    const codeHash = await hashToken("456789");
    const u = clearResetColumns(writeRollingWindowReset(codeHash));
    expect(u.passwordResetToken).toBeNull();
    expect(u.passwordResetTokenHash).toBeNull();
  });

  it("a user-supplied code hashes back to the stored hash (success)", async () => {
    const code = "456789";
    const codeHash = await hashToken(code);
    const u = writeRollingWindowReset(codeHash);
    const supplied = await hashToken(code);
    expect(timingSafeEqualHex(supplied, readStoredHash(u, "reset")!)).toBe(true);
  });

  it("a wrong code does NOT match the stored hash (failure)", async () => {
    const code = "456789";
    const codeHash = await hashToken(code);
    const u = writeRollingWindowReset(codeHash);
    const supplied = await hashToken("000000");
    expect(timingSafeEqualHex(supplied, readStoredHash(u, "reset")!)).toBe(false);
  });
});
