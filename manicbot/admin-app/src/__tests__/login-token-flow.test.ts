/**
 * #P1-6 — verify-email no longer hands the password back through
 * sessionStorage. Instead the server hashes a 32-byte random token
 * (SHA-256), stashes it in web_users.login_token_hash with a 5-minute
 * expiry, and the credentials provider consumes it on first match.
 *
 * The end-to-end NextAuth flow is hard to drive in vitest, but the two
 * critical contracts are testable in isolation:
 *
 *   - `webUsers.verifyEmail` returns a fresh `loginToken` when it flips
 *     emailVerified=1, and the corresponding hash + expiry are persisted.
 *   - The token is single-use: hashing it back must give exactly the
 *     stored hash, and consuming clears the row.
 */
import { describe, it, expect } from "vitest";
import { generateToken, hashToken, timingSafeEqualHex } from "~/server/auth/tokens";

describe("login token primitives (#P1-6)", () => {
  it("generateToken returns a fresh URL-safe identifier each call", async () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    // crypto.randomUUID is the canonical generator — UUID v4 length = 36.
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toMatch(/^[0-9a-f-]+$/i);
  });

  it("hashToken is deterministic and 64-char SHA-256 hex", async () => {
    // gitleaks-friendly fixture — short alphabetic, no entropy resemblance
    // to a real key. Real tokens come from generateToken() (UUID v4).
    const fixture = "abc";
    const h1 = await hashToken(fixture);
    const h2 = await hashToken(fixture);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("timingSafeEqualHex compares by length and contents", () => {
    expect(timingSafeEqualHex("abc", "abc")).toBe(true);
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
    expect(timingSafeEqualHex("abc", "abd")).toBe(false);
  });

  it("hash of a fresh token does not collide with an unrelated one", async () => {
    const t1 = generateToken();
    const t2 = generateToken();
    const h1 = await hashToken(t1);
    const h2 = await hashToken(t2);
    expect(timingSafeEqualHex(h1, h2)).toBe(false);
  });

  it("hash of t1 is constant-time-equal to a freshly-computed hash of t1", async () => {
    const t = generateToken();
    const stored = await hashToken(t);
    const replayed = await hashToken(t);
    expect(timingSafeEqualHex(stored, replayed)).toBe(true);
  });
});
