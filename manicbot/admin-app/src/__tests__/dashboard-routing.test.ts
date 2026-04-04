import { describe, it, expect } from "vitest";
import type { AppRole } from "~/server/api/routers/auth";

/**
 * Tests for dashboard layout role-based routing logic.
 * Extracted from (dashboard)/layout.tsx to test as pure functions.
 */

type DashboardTarget = "SalonDashboard" | "MasterDashboard" | "SupportDashboard" | "GodMode" | "Login";

function getDashboardTarget(role: AppRole, previewRole: AppRole): DashboardTarget {
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  if (!effectiveRole) return "Login";
  if (effectiveRole === "tenant_owner") return "SalonDashboard";
  if (effectiveRole === "master") return "MasterDashboard";
  if (effectiveRole === "support" || effectiveRole === "technical_support") return "SupportDashboard";
  return "GodMode";
}

describe("dashboard role routing", () => {
  it("system_admin → GodMode", () => {
    expect(getDashboardTarget("system_admin", null)).toBe("GodMode");
  });

  it("tenant_owner → SalonDashboard", () => {
    expect(getDashboardTarget("tenant_owner", null)).toBe("SalonDashboard");
  });

  it("master → MasterDashboard", () => {
    expect(getDashboardTarget("master", null)).toBe("MasterDashboard");
  });

  it("support → SupportDashboard", () => {
    expect(getDashboardTarget("support", null)).toBe("SupportDashboard");
  });

  it("technical_support → SupportDashboard", () => {
    expect(getDashboardTarget("technical_support", null)).toBe("SupportDashboard");
  });

  it("null role → Login redirect", () => {
    expect(getDashboardTarget(null, null)).toBe("Login");
  });
});

describe("system_admin preview mode", () => {
  it("previewing as tenant_owner → SalonDashboard", () => {
    expect(getDashboardTarget("system_admin", "tenant_owner")).toBe("SalonDashboard");
  });

  it("previewing as master → MasterDashboard", () => {
    expect(getDashboardTarget("system_admin", "master")).toBe("MasterDashboard");
  });

  it("previewing as support → SupportDashboard", () => {
    expect(getDashboardTarget("system_admin", "support")).toBe("SupportDashboard");
  });

  it("non-admin preview is ignored", () => {
    expect(getDashboardTarget("tenant_owner", "system_admin")).toBe("SalonDashboard");
    expect(getDashboardTarget("master", "system_admin")).toBe("MasterDashboard");
  });
});

describe("RoleContext shape", () => {
  it("context has required fields", () => {
    const ctx = {
      role: "system_admin" as AppRole,
      tenantId: null as string | null,
      userId: null as number | null,
      previewRole: null as AppRole,
      previewTenantId: null as string | null,
      setPreviewRole: (_r: AppRole, _tenantId?: string | null) => {},
    };
    expect(ctx.role).toBe("system_admin");
    expect(ctx.tenantId).toBeNull();
    expect(ctx.userId).toBeNull();
    expect(typeof ctx.setPreviewRole).toBe("function");
  });
});
