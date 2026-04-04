import { describe, it, expect } from "vitest";
import type { AppRole } from "~/server/api/routers/auth";

/**
 * Tests for auth router getMyRole logic.
 * We extract the pure decision logic since the actual tRPC context
 * requires D1 bindings that aren't available in test.
 */

interface MockCtx {
  user: { id: number } | null;
  webUser: { email: string; webRole: string; tenantId: string | null } | null;
  adminChatId: string | null;
  platformRows: Array<{ chatId: number; role: string }>;
  tenantRows: Array<{ chatId: number; role: string; tenantId: string }>;
}

function getMyRoleLogic(ctx: MockCtx): { role: AppRole; tenantId: string | null } {
  // Web session path
  if (!ctx.user && ctx.webUser) {
    return { role: ctx.webUser.webRole as AppRole, tenantId: ctx.webUser.tenantId };
  }

  if (!ctx.user) {
    return { role: null, tenantId: null };
  }

  // Creator fallback
  if (ctx.adminChatId && String(ctx.user.id) === ctx.adminChatId) {
    return { role: "system_admin", tenantId: null };
  }

  const platformRow = ctx.platformRows.find((r) => r.chatId === ctx.user!.id);
  if (platformRow) {
    const role = platformRow.role as AppRole;
    if (role === "system_admin") {
      if (ctx.adminChatId && String(ctx.user!.id) === ctx.adminChatId) {
        return { role: "system_admin", tenantId: null };
      }
    } else if (role === "support" || role === "technical_support") {
      return { role, tenantId: null };
    }
  }

  // Tenant roles
  const tenantRow = ctx.tenantRows.find((r) => r.chatId === ctx.user!.id);
  if (tenantRow) {
    const role = tenantRow.role as AppRole;
    if (role === "tenant_owner" || role === "master") {
      return { role, tenantId: tenantRow.tenantId };
    }
  }

  return { role: null, tenantId: null };
}

describe("getMyRole — web session path", () => {
  it("returns webUser role when no Telegram user", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { email: "admin@test.com", webRole: "system_admin", tenantId: null },
      adminChatId: null,
      platformRows: [],
      tenantRows: [],
    });
    expect(result.role).toBe("system_admin");
    expect(result.tenantId).toBeNull();
  });

  it("returns tenant_owner with tenantId for web user", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: { email: "owner@salon.com", webRole: "tenant_owner", tenantId: "t_abc" },
      adminChatId: null,
      platformRows: [],
      tenantRows: [],
    });
    expect(result.role).toBe("tenant_owner");
    expect(result.tenantId).toBe("t_abc");
  });
});

describe("getMyRole — unauthenticated", () => {
  it("returns null role when no user and no webUser", () => {
    const result = getMyRoleLogic({
      user: null,
      webUser: null,
      adminChatId: null,
      platformRows: [],
      tenantRows: [],
    });
    expect(result.role).toBeNull();
  });
});

describe("getMyRole — ADMIN_CHAT_ID fallback", () => {
  it("returns system_admin for creator chat ID", () => {
    const result = getMyRoleLogic({
      user: { id: 12345 },
      webUser: null,
      adminChatId: "12345",
      platformRows: [],
      tenantRows: [],
    });
    expect(result.role).toBe("system_admin");
  });

  it("does not match different chat ID", () => {
    const result = getMyRoleLogic({
      user: { id: 99999 },
      webUser: null,
      adminChatId: "12345",
      platformRows: [],
      tenantRows: [],
    });
    expect(result.role).toBeNull();
  });
});

describe("getMyRole — platform roles", () => {
  it("ignores system_admin in DB when user is not ADMIN_CHAT_ID", () => {
    const result = getMyRoleLogic({
      user: { id: 100 },
      webUser: null,
      adminChatId: "999",
      platformRows: [{ chatId: 100, role: "system_admin" }],
      tenantRows: [],
    });
    expect(result.role).toBeNull();
  });

  it("returns support role from platform_roles", () => {
    const result = getMyRoleLogic({
      user: { id: 100 },
      webUser: null,
      adminChatId: null,
      platformRows: [{ chatId: 100, role: "support" }],
      tenantRows: [],
    });
    expect(result.role).toBe("support");
    expect(result.tenantId).toBeNull();
  });

  it("ignores non-staff platform roles", () => {
    const result = getMyRoleLogic({
      user: { id: 100 },
      webUser: null,
      adminChatId: null,
      platformRows: [{ chatId: 100, role: "tenant_owner" }],
      tenantRows: [],
    });
    expect(result.role).toBeNull();
  });
});

describe("getMyRole — tenant roles", () => {
  it("returns tenant_owner with tenantId", () => {
    const result = getMyRoleLogic({
      user: { id: 200 },
      webUser: null,
      adminChatId: null,
      platformRows: [],
      tenantRows: [{ chatId: 200, role: "tenant_owner", tenantId: "t_xyz" }],
    });
    expect(result.role).toBe("tenant_owner");
    expect(result.tenantId).toBe("t_xyz");
  });

  it("returns master with tenantId", () => {
    const result = getMyRoleLogic({
      user: { id: 300 },
      webUser: null,
      adminChatId: null,
      platformRows: [],
      tenantRows: [{ chatId: 300, role: "master", tenantId: "t_salon" }],
    });
    expect(result.role).toBe("master");
    expect(result.tenantId).toBe("t_salon");
  });
});

describe("getMyRole — priority", () => {
  it("ADMIN_CHAT_ID takes priority over platform roles", () => {
    const result = getMyRoleLogic({
      user: { id: 42 },
      webUser: null,
      adminChatId: "42",
      platformRows: [{ chatId: 42, role: "support" }],
      tenantRows: [],
    });
    expect(result.role).toBe("system_admin");
  });

  it("platform role takes priority over tenant role", () => {
    const result = getMyRoleLogic({
      user: { id: 55 },
      webUser: null,
      adminChatId: null,
      platformRows: [{ chatId: 55, role: "support" }],
      tenantRows: [{ chatId: 55, role: "tenant_owner", tenantId: "t_1" }],
    });
    expect(result.role).toBe("support");
    expect(result.tenantId).toBeNull();
  });
});
