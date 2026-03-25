import { describe, it, expect } from "vitest";
import type { AppRole } from "~/server/api/routers/auth";

describe("AppRole type contract", () => {
  const validRoles: AppRole[] = [
    "system_admin",
    "support",
    "technical_support",
    "tenant_owner",
    "master",
    null,
  ];

  it("all expected roles exist", () => {
    const nonNull = validRoles.filter(r => r !== null) as string[];
    expect(nonNull).toContain("system_admin");
    expect(nonNull).toContain("support");
    expect(nonNull).toContain("technical_support");
    expect(nonNull).toContain("tenant_owner");
    expect(nonNull).toContain("master");
  });

  it("null is a valid role (unauthenticated / client)", () => {
    const r: AppRole = null;
    expect(r).toBeNull();
  });
});

describe("Role routing logic", () => {
  // Mirrors the routing logic in TelegramGate
  function getEffectiveRole(role: AppRole, previewRole: AppRole): AppRole {
    return role === "system_admin" && previewRole ? previewRole : role;
  }

  it("system_admin with no preview → system_admin", () => {
    expect(getEffectiveRole("system_admin", null)).toBe("system_admin");
  });

  it("system_admin previewing as tenant_owner → tenant_owner", () => {
    expect(getEffectiveRole("system_admin", "tenant_owner")).toBe("tenant_owner");
  });

  it("system_admin previewing as master → master", () => {
    expect(getEffectiveRole("system_admin", "master")).toBe("master");
  });

  it("system_admin previewing as support → support", () => {
    expect(getEffectiveRole("system_admin", "support")).toBe("support");
  });

  it("non-admin cannot set preview (preview role ignored)", () => {
    // tenant_owner with previewRole set — should stay tenant_owner
    expect(getEffectiveRole("tenant_owner", "master")).toBe("tenant_owner");
  });

  it("null role stays null regardless of previewRole", () => {
    expect(getEffectiveRole(null, "system_admin")).toBeNull();
  });
});
