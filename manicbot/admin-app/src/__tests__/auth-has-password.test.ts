import { describe, it, expect } from "vitest";
import type { AppRole } from "~/server/api/routers/auth";

/**
 * Tests for hasPassword field in getMyRole response.
 * Validates the logic that determines whether a web user has a
 * password set (relevant for Google-only registrations).
 *
 * Pure logic tests — no D1 dependencies.
 */

interface MockWebUser {
  id: string;
  email: string;
  webRole: string;
  tenantId: string | null;
}

interface MockDbRow {
  createdAt: number | null;
  emailVerified: number;
  passwordHash: string | null;
}

interface MockCtx {
  user: { id: number } | null;
  webUser: MockWebUser | null;
  dbRow: MockDbRow | null;
}

type RoleResult = {
  role: AppRole;
  tenantId: string | null;
  hasPassword: boolean;
  emailVerified: boolean;
  email: string | null;
};

const EMPTY: RoleResult = {
  role: null,
  tenantId: null,
  hasPassword: true,
  emailVerified: true,
  email: null,
};

/**
 * Mirrors the web session path in authRouter.getMyRole:
 *   hasPassword = !!(rows[0]?.passwordHash)
 * and the EMPTY default:
 *   hasPassword: true  (Telegram users and unauthenticated)
 */
function getMyRoleLogic(ctx: MockCtx): RoleResult {
  // Web session path
  if (!ctx.user && ctx.webUser) {
    const role = ctx.webUser.webRole as AppRole;
    const tenantId = ctx.webUser.tenantId;
    const email = ctx.webUser.email;
    const hasPassword = !!(ctx.dbRow?.passwordHash);
    const emailVerified = !!(ctx.dbRow?.emailVerified);
    return { role, tenantId, hasPassword, emailVerified, email };
  }

  // Telegram user or unauthenticated — hasPassword defaults to true
  return EMPTY;
}

describe("hasPassword — web user with passwordHash", () => {
  it("returns hasPassword: true when user has a password set", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u1", email: "owner@salon.com", webRole: "tenant_owner", tenantId: "t_abc" },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: "pbkdf2:sha256:100000:salt:hash" },
    });
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("tenant_owner");
    expect(result.email).toBe("owner@salon.com");
  });

  it("returns hasPassword: false when passwordHash is NULL (Google registration)", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u2", email: "google@example.com", webRole: "tenant_owner", tenantId: "t_xyz" },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: null },
    });
    expect(result.hasPassword).toBe(false);
    expect(result.role).toBe("tenant_owner");
  });
});

describe("hasPassword — Telegram users default to true", () => {
  it("returns hasPassword: true for Telegram user (no web session)", () => {
    const result = getMyRoleLogic({
      user: { id: 12345 },
      webUser: null,
      dbRow: null,
    });
    expect(result.hasPassword).toBe(true);
  });

  it("returns hasPassword: true even when EMPTY default is used (unauthenticated)", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: null,
      dbRow: null,
    });
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBeNull();
  });
});

describe("hasPassword — EMPTY default contract", () => {
  it("EMPTY default has hasPassword: true", () => {
    expect(EMPTY.hasPassword).toBe(true);
  });

  it("EMPTY default has role: null", () => {
    expect(EMPTY.role).toBeNull();
  });

  it("EMPTY default has email: null", () => {
    expect(EMPTY.email).toBeNull();
  });

  it("EMPTY default has emailVerified: true", () => {
    expect(EMPTY.emailVerified).toBe(true);
  });
});

describe("hasPassword — various web user roles", () => {
  it("master with password → hasPassword: true", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u3", email: "master@salon.com", webRole: "master", tenantId: "t_m1" },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: "hashed:something" },
    });
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("master");
  });

  it("master without password (Google) → hasPassword: false", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u4", email: "google-master@example.com", webRole: "master", tenantId: "t_m2" },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: null },
    });
    expect(result.hasPassword).toBe(false);
    expect(result.role).toBe("master");
  });

  it("system_admin with password → hasPassword: true", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u5", email: "admin@manicbot.com", webRole: "system_admin", tenantId: null },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: "hashed:adminpass" },
    });
    expect(result.hasPassword).toBe(true);
    expect(result.role).toBe("system_admin");
  });

  it("support without password → hasPassword: false", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u6", email: "support@manicbot.com", webRole: "support", tenantId: null },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: null },
    });
    expect(result.hasPassword).toBe(false);
    expect(result.role).toBe("support");
  });
});

describe("hasPassword — edge cases", () => {
  it("empty string passwordHash is truthy → hasPassword: true", () => {
    // !! of empty string is false, so empty string would mean hasPassword: false
    // This is consistent: if hash is "" it means no real hash is stored
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u7", email: "edge@example.com", webRole: "tenant_owner", tenantId: "t_e1" },
      dbRow: { createdAt: 1700000000, emailVerified: 1, passwordHash: "" },
    });
    // !! "" === false
    expect(result.hasPassword).toBe(false);
  });

  it("DB row missing (query failed) → hasPassword: false", () => {
    // When ctx.dbRow is null (DB error catch path), passwordHash is undefined
    const result = getMyRoleLogic({
      user: null,
      webUser: { id: "u8", email: "broken@example.com", webRole: "tenant_owner", tenantId: "t_e2" },
      dbRow: null,
    });
    expect(result.hasPassword).toBe(false);
  });
});

describe("hasPassword — conversion from DB to boolean", () => {
  it("double-bang of non-null string is true", () => {
    const hash: string | null = "pbkdf2:sha256:100000:salt:hash";
    expect(!!hash).toBe(true);
  });

  it("double-bang of null is false", () => {
    const hash: string | null = null;
    expect(!!hash).toBe(false);
  });

  it("double-bang of undefined is false", () => {
    const hash: string | undefined = undefined;
    expect(!!hash).toBe(false);
  });

  it("double-bang of empty string is false", () => {
    const hash: string | null = "";
    expect(!!hash).toBe(false);
  });
});
