import { describe, it, expect } from "vitest";

/**
 * Tests for the NextAuth signIn/jwt/session callback logic.
 * We test the pure logic extracted from auth.ts callbacks,
 * since NextAuth itself is mocked in the test environment.
 */

describe("signIn callback logic", () => {
  // Replicate the signIn callback decision logic
  function shouldAllowGoogleSignIn(
    email: string | undefined,
    webUserRows: Array<{ id: string; email: string; role: string; tenantId: string | null }>,
  ): { allowed: boolean; role: string; tenantId: string | null } {
    if (!email) {
      return { allowed: true, role: "client", tenantId: null };
    }
    const normalizedEmail = email.toLowerCase().trim();
    const match = webUserRows.find((r) => r.email === normalizedEmail);
    if (match) {
      return { allowed: true, role: match.role, tenantId: match.tenantId };
    }
    // No match: allow with default role (as per current auth.ts logic)
    return { allowed: true, role: "client", tenantId: null };
  }

  it("matches email case-insensitively", () => {
    const rows = [{ id: "1", email: "admin@test.com", role: "system_admin", tenantId: null }];
    const result = shouldAllowGoogleSignIn("Admin@Test.COM", rows);
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("system_admin");
  });

  it("trims email whitespace", () => {
    const rows = [{ id: "1", email: "admin@test.com", role: "system_admin", tenantId: null }];
    const result = shouldAllowGoogleSignIn("  admin@test.com  ", rows);
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("system_admin");
  });

  it("returns client role when email not in web_users", () => {
    const rows = [{ id: "1", email: "admin@test.com", role: "system_admin", tenantId: null }];
    const result = shouldAllowGoogleSignIn("stranger@example.com", rows);
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("client");
  });

  it("returns tenant_owner role with tenantId", () => {
    const rows = [{ id: "2", email: "owner@salon.com", role: "tenant_owner", tenantId: "t_abc" }];
    const result = shouldAllowGoogleSignIn("owner@salon.com", rows);
    expect(result.role).toBe("tenant_owner");
    expect(result.tenantId).toBe("t_abc");
  });

  it("allows login when email is undefined", () => {
    const result = shouldAllowGoogleSignIn(undefined, []);
    expect(result.allowed).toBe(true);
    expect(result.role).toBe("client");
  });
});

describe("JWT callback logic", () => {
  function buildToken(
    token: Record<string, unknown>,
    user: Record<string, unknown> | undefined,
  ) {
    if (user) {
      return {
        ...token,
        tenantId: (user as any).tenantId ?? null,
        webRole: (user as any).webRole ?? "tenant_owner",
      };
    }
    return token;
  }

  it("copies tenantId and webRole from user to token on first sign-in", () => {
    const token = buildToken({}, { tenantId: "t_123", webRole: "system_admin" });
    expect(token.tenantId).toBe("t_123");
    expect(token.webRole).toBe("system_admin");
  });

  it("defaults webRole to tenant_owner when not set", () => {
    const token = buildToken({}, { tenantId: null });
    expect(token.webRole).toBe("tenant_owner");
  });

  it("preserves existing token when no user (session refresh)", () => {
    const existing = { tenantId: "t_x", webRole: "support", sub: "abc" };
    const token = buildToken(existing, undefined);
    expect(token.tenantId).toBe("t_x");
    expect(token.webRole).toBe("support");
  });
});

describe("session callback logic", () => {
  function buildSession(
    session: { user: Record<string, unknown> },
    token: Record<string, unknown>,
  ) {
    return {
      ...session,
      user: {
        ...session.user,
        tenantId: token.tenantId ?? null,
        webRole: token.webRole ?? "tenant_owner",
      },
    };
  }

  it("attaches tenantId and webRole to session.user", () => {
    const session = buildSession(
      { user: { email: "a@b.com" } },
      { tenantId: "t_1", webRole: "system_admin" },
    );
    expect(session.user.tenantId).toBe("t_1");
    expect(session.user.webRole).toBe("system_admin");
  });

  it("defaults webRole to tenant_owner", () => {
    const session = buildSession(
      { user: {} },
      {},
    );
    expect(session.user.webRole).toBe("tenant_owner");
    expect(session.user.tenantId).toBeNull();
  });
});
