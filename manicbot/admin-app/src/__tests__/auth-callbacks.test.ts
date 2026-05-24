/**
 * NextAuth callbacks — structural pin on the real source.
 *
 * Phase 2 cleanup: the NextAuth callbacks (signIn / jwt / session) are
 * defined inline inside `NextAuth({ ... })` in
 * `~/server/auth/auth.ts` and are not exported as standalone functions.
 * The previous test file reimplemented findWebUserRow / buildToken /
 * buildSession in the test, so a refactor that broke the real callbacks
 * (e.g. dropped the .toLowerCase() in the email lookup) would still pass.
 *
 * This rewrite pins the EXACT lines we care about in the real source —
 * a regression on case-insensitive email match, tenantId/webRole
 * copy, default-role fallback, or the #S8 stale-token rejection breaks
 * the suite.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SRC = readFileSync(path.join(ROOT, "server/auth/auth.ts"), "utf8");

describe("NextAuth signIn callback — Google web_users lookup", () => {
  it("normalizes email case + trim before the DB lookup", () => {
    // The lookup must compare against the lowercased+trimmed email so
    // the user typing `Admin@Test.COM` matches the stored `admin@test.com`.
    expect(SRC).toMatch(
      /user\.email\.toLowerCase\(\)\.trim\(\)/,
    );
    // It must run inside the `eq(webUsers.email, ...)` clause specifically.
    expect(SRC).toMatch(
      /eq\(\s*webUsers\.email\s*,\s*user\.email\.toLowerCase\(\)\.trim\(\)\s*\)/,
    );
  });

  it("only runs the Google branch for account.provider === 'google'", () => {
    expect(SRC).toMatch(/account\?\.provider\s*===\s*"google"/);
  });

  it("returns false (refuses sign-in) when AUTH_SECRET is missing", () => {
    expect(SRC).toMatch(/AUTH_SECRET missing/);
    expect(SRC).toMatch(/return false;/);
  });

  it("redirects unknown Google emails to /register?g=<prefill-token>", () => {
    expect(SRC).toMatch(/signGooglePrefillToken\(/);
    expect(SRC).toMatch(/\/register\?g=/);
  });

  it("copies tenantId, webRole, id, isEmailVerified from the matched webUsers row onto the NextAuth user", () => {
    expect(SRC).toMatch(/user\.tenantId\s*=\s*webUser\.tenantId\s*\?\?\s*null/);
    expect(SRC).toMatch(/user\.webRole\s*=\s*webUser\.role/);
    expect(SRC).toMatch(/user\.id\s*=\s*webUser\.id/);
    expect(SRC).toMatch(/user\.isEmailVerified\s*=\s*!!webUser\.emailVerified/);
  });
});

describe("NextAuth jwt callback — token enrichment", () => {
  it("copies tenantId, webRole, emailVerified from user → token on first sign-in", () => {
    expect(SRC).toMatch(/t\.tenantId\s*=\s*user\.tenantId\s*\?\?\s*null/);
    expect(SRC).toMatch(/t\.webRole\s*=\s*user\.webRole\s*\?\?\s*"tenant_owner"/);
    expect(SRC).toMatch(/t\.emailVerified\s*=\s*user\.isEmailVerified\s*\?\?\s*true/);
  });

  it("snapshots password_changed_at (#S8 — stale-token defense)", () => {
    expect(SRC).toMatch(/passwordChangedAt:\s*webUsers\.passwordChangedAt/);
    expect(SRC).toMatch(/t\.passwordChangedAt\s*=\s*rows\[0\]\?\.pca\s*\?\?\s*0/);
  });

  it("re-checks DB on every refresh for role demotions + password changes", () => {
    // The else-if branch on token.sub queries webUsers fresh.
    expect(SRC).toMatch(/eq\(webUsers\.id,\s*t\.sub\)/);
    expect(SRC).toMatch(/sessionsInvalidatedAt:\s*webUsers\.sessionsInvalidatedAt/);
  });

  it("marks token stale when passwordChangedAt OR sessionsInvalidatedAt is newer than the JWT iat", () => {
    expect(SRC).toMatch(/storedPca\s*>\s*jwtIat\s*\|\|\s*storedSia\s*>\s*jwtIat/);
    expect(SRC).toMatch(/\.stale\s*=\s*true/);
  });
});

describe("NextAuth session callback — token → session", () => {
  it("rejects stale sessions (returns null) so client is forced to re-login", () => {
    expect(SRC).toMatch(/if \(t\.stale\)/);
    expect(SRC).toMatch(/return null as unknown as typeof session/);
  });

  it("copies tenantId, webRole, isEmailVerified onto session.user", () => {
    expect(SRC).toMatch(/session\.user\.id\s*=\s*token\.sub\s*\?\?\s*""/);
    expect(SRC).toMatch(/session\.user\.tenantId\s*=\s*t\.tenantId\s*\?\?\s*null/);
    expect(SRC).toMatch(/session\.user\.webRole\s*=\s*t\.webRole\s*\?\?\s*"tenant_owner"/);
    expect(SRC).toMatch(/session\.user\.isEmailVerified\s*=\s*t\.emailVerified\s*\?\?\s*true/);
  });
});

describe("NextAuth session strategy", () => {
  it("uses JWT strategy with an 8-hour max age", () => {
    expect(SRC).toMatch(/strategy:\s*"jwt"\s*,\s*maxAge:\s*8\s*\*\s*60\s*\*\s*60/);
  });

  it("uses /login as the signIn page", () => {
    expect(SRC).toMatch(/signIn:\s*"\/login"/);
  });
});
