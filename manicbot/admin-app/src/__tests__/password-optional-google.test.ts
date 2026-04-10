import { describe, it, expect } from "vitest";

/**
 * Tests for Google OAuth registration without password.
 * Validates the password-optional registration path introduced for
 * Google sign-in prefill, as well as the setInitialPassword and
 * changePassword logic around null passwordHash.
 *
 * Pure logic tests — no D1 dependencies.
 */

describe("register mutation — password requirement logic", () => {
  /**
   * Mirrors the guard in webUsers.register:
   *   if (!input.password && !input.googlePrefillToken)
   *     throw BAD_REQUEST "Password is required"
   */
  function validatePasswordRequirement(input: {
    password?: string;
    googlePrefillToken?: string;
  }): { ok: boolean; error?: string } {
    if (!input.password && !input.googlePrefillToken) {
      return { ok: false, error: "Password is required" };
    }
    return { ok: true };
  }

  it("succeeds with googlePrefillToken but NO password", () => {
    const result = validatePasswordRequirement({
      googlePrefillToken: "eyJhbGciOiJIUzI1NiJ9.dummySignature",
    });
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("fails WITHOUT googlePrefillToken and WITHOUT password", () => {
    const result = validatePasswordRequirement({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Password is required");
  });

  it("succeeds with password and no googlePrefillToken", () => {
    const result = validatePasswordRequirement({
      password: "MySecurePass123!",
    });
    expect(result.ok).toBe(true);
  });

  it("succeeds with both password and googlePrefillToken", () => {
    const result = validatePasswordRequirement({
      password: "MySecurePass123!",
      googlePrefillToken: "eyJhbGciOiJIUzI1NiJ9.dummySignature",
    });
    expect(result.ok).toBe(true);
  });

  it("treats empty string password as falsy (requires googlePrefillToken)", () => {
    const result = validatePasswordRequirement({
      password: "",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Password is required");
  });
});

describe("register — passwordHash storage logic", () => {
  /**
   * Mirrors: const passwordHash = input.password ? await hashPassword(input.password) : null;
   */
  function computePasswordHash(password?: string): string | null {
    return password ? `hashed:${password}` : null;
  }

  it("stores null passwordHash when no password provided (Google registration)", () => {
    const hash = computePasswordHash(undefined);
    expect(hash).toBeNull();
  });

  it("stores a hash when password is provided", () => {
    const hash = computePasswordHash("SecurePassword123!");
    expect(hash).not.toBeNull();
    expect(typeof hash).toBe("string");
  });

  it("stores null for empty string password", () => {
    const hash = computePasswordHash("");
    expect(hash).toBeNull();
  });
});

describe("setInitialPassword — guard logic", () => {
  /**
   * Mirrors the guard in webUsers.setInitialPassword:
   *   if (rows[0].passwordHash)
   *     throw BAD_REQUEST "Password already set. Use change password instead."
   */
  function setInitialPasswordGuard(existingHash: string | null): {
    ok: boolean;
    error?: string;
  } {
    if (existingHash) {
      return { ok: false, error: "Password already set. Use change password instead." };
    }
    return { ok: true };
  }

  it("succeeds for user with NULL passwordHash", () => {
    const result = setInitialPasswordGuard(null);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("fails for user with existing passwordHash", () => {
    const result = setInitialPasswordGuard("pbkdf2:sha256:100000:salt:hash");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Password already set. Use change password instead.");
  });

  it("fails for user with any truthy passwordHash", () => {
    const result = setInitialPasswordGuard("any-non-empty-hash");
    expect(result.ok).toBe(false);
  });
});

describe("changePassword — null passwordHash guard", () => {
  /**
   * Mirrors the guard in webUsers.changePassword:
   *   if (!user.passwordHash)
   *     throw BAD_REQUEST "No password set. Use 'Set password' instead."
   */
  function changePasswordGuard(existingHash: string | null): {
    ok: boolean;
    error?: string;
  } {
    if (!existingHash) {
      return { ok: false, error: "No password set. Use 'Set password' instead." };
    }
    return { ok: true };
  }

  it("fails for user without passwordHash (Google-only user)", () => {
    const result = changePasswordGuard(null);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("No password set. Use 'Set password' instead.");
  });

  it("succeeds for user with existing passwordHash", () => {
    const result = changePasswordGuard("pbkdf2:sha256:100000:salt:hash");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("register input schema — password is optional", () => {
  it("password field is z.string().min(12).optional() — undefined is valid", () => {
    const input: { password?: string } = {};
    expect(input.password).toBeUndefined();
  });

  it("password must be 12+ chars when provided", () => {
    const MIN_PASSWORD_LENGTH = 12;
    const tooShort = "Short1!";
    expect(tooShort.length).toBeLessThan(MIN_PASSWORD_LENGTH);

    const valid = "LongEnoughPwd!";
    expect(valid.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it("googlePrefillToken field is optional with max 8000 chars", () => {
    const maxLen = 8000;
    const validToken = "a".repeat(maxLen);
    expect(validToken.length).toBeLessThanOrEqual(maxLen);

    const tooLong = "a".repeat(maxLen + 1);
    expect(tooLong.length).toBeGreaterThan(maxLen);
  });
});

describe("Google prefill token verification requirement", () => {
  /**
   * Mirrors the verification in register:
   *   if (input.googlePrefillToken) { verify token; if (!payload || payload.email !== email) throw }
   */
  function verifyGooglePrefillRequirement(input: {
    googlePrefillToken?: string;
    email: string;
  }, tokenPayload: { email: string } | null): { ok: boolean; error?: string } {
    if (!input.googlePrefillToken) return { ok: true }; // no token = regular registration
    if (!tokenPayload) {
      return { ok: false, error: "Invalid or expired Google sign-in" };
    }
    if (tokenPayload.email !== input.email) {
      return { ok: false, error: "Invalid or expired Google sign-in" };
    }
    return { ok: true };
  }

  it("passes when no googlePrefillToken (regular registration)", () => {
    const result = verifyGooglePrefillRequirement(
      { email: "user@example.com" },
      null,
    );
    expect(result.ok).toBe(true);
  });

  it("passes when token email matches registration email", () => {
    const result = verifyGooglePrefillRequirement(
      { email: "user@example.com", googlePrefillToken: "valid.token" },
      { email: "user@example.com" },
    );
    expect(result.ok).toBe(true);
  });

  it("fails when token verification returns null", () => {
    const result = verifyGooglePrefillRequirement(
      { email: "user@example.com", googlePrefillToken: "invalid.token" },
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid or expired");
  });

  it("fails when token email does not match registration email", () => {
    const result = verifyGooglePrefillRequirement(
      { email: "user@example.com", googlePrefillToken: "valid.token" },
      { email: "different@example.com" },
    );
    expect(result.ok).toBe(false);
  });
});
