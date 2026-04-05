import { describe, it, expect } from "vitest";

/**
 * Pure helpers mirroring NextAuth jwt/session callbacks in auth.ts
 * (Google redirect + signIn DB branch are covered by google-prefill-token + auth-base-url tests).
 */

describe("Google web_users match (case / trim)", () => {
  function findWebUserRow(
    email: string | undefined,
    rows: Array<{ id: string; email: string; role: string; tenantId: string | null }>,
  ) {
    if (!email) return undefined;
    const normalized = email.toLowerCase().trim();
    return rows.find((r) => r.email === normalized);
  }

  it("matches email case-insensitively", () => {
    const rows = [{ id: "1", email: "admin@test.com", role: "system_admin", tenantId: null }];
    expect(findWebUserRow("Admin@Test.COM", rows)?.role).toBe("system_admin");
  });

  it("trims email whitespace", () => {
    const rows = [{ id: "1", email: "admin@test.com", role: "system_admin", tenantId: null }];
    expect(findWebUserRow("  admin@test.com  ", rows)?.role).toBe("system_admin");
  });

  it("returns undefined when email not in web_users", () => {
    const rows = [{ id: "1", email: "admin@test.com", role: "system_admin", tenantId: null }];
    expect(findWebUserRow("stranger@example.com", rows)).toBeUndefined();
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
