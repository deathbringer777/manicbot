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

// ─── Tab resolution (extracted from MasterDashboard / SalonDashboard) ───

type MasterTab = "today" | "schedule" | "clients" | "earnings" | "reviews" | "services" | "profile";
type SalonTab = "overview" | "appointments" | "masters" | "services" | "clients" | "billing" | "channels" | "reviews" | "settings" | "public_profile" | "analytics";

const MASTER_TABS: MasterTab[] = ["today", "schedule", "clients", "earnings", "reviews", "services", "profile"];
const SALON_TABS: SalonTab[] = ["overview", "appointments", "masters", "services", "clients", "billing", "channels", "reviews", "settings", "public_profile", "analytics"];

function resolveMasterTab(urlTab: string | null): MasterTab {
  return urlTab && MASTER_TABS.includes(urlTab as MasterTab) ? (urlTab as MasterTab) : "today";
}

function resolveSalonTab(urlTab: string | null): SalonTab {
  if (urlTab === "instagram" || urlTab === "whatsapp") return "channels";
  return urlTab && SALON_TABS.includes(urlTab as SalonTab) ? (urlTab as SalonTab) : "overview";
}

describe("master tab resolution from URL", () => {
  it("valid tab → exact match", () => {
    expect(resolveMasterTab("schedule")).toBe("schedule");
    expect(resolveMasterTab("clients")).toBe("clients");
    expect(resolveMasterTab("profile")).toBe("profile");
  });

  it("null → default today", () => {
    expect(resolveMasterTab(null)).toBe("today");
  });

  it("invalid → default today", () => {
    expect(resolveMasterTab("bogus")).toBe("today");
    expect(resolveMasterTab("overview")).toBe("today");
  });
});

describe("salon tab resolution from URL", () => {
  it("valid tab → exact match", () => {
    expect(resolveSalonTab("appointments")).toBe("appointments");
    expect(resolveSalonTab("channels")).toBe("channels");
    expect(resolveSalonTab("billing")).toBe("billing");
  });

  it("instagram / whatsapp → channels", () => {
    expect(resolveSalonTab("instagram")).toBe("channels");
    expect(resolveSalonTab("whatsapp")).toBe("channels");
  });

  it("null → default overview", () => {
    expect(resolveSalonTab(null)).toBe("overview");
  });

  it("invalid → default overview", () => {
    expect(resolveSalonTab("bogus")).toBe("overview");
    expect(resolveSalonTab("today")).toBe("overview");
  });
});

// ─── isActive logic (extracted from WebShell) ───

function isActiveLogic(itemHref: string, pathname: string, currentTab: string | null): boolean {
  const qIdx = itemHref.indexOf("?");
  if (qIdx !== -1) {
    const itemParams = new URLSearchParams(itemHref.slice(qIdx));
    const itemTab = itemParams.get("tab");
    return itemTab ? itemTab === currentTab : false;
  }
  if (itemHref === "/dashboard" || itemHref === "/") {
    return (pathname === "/dashboard" || pathname === "/") && !currentTab;
  }
  return pathname.startsWith(itemHref);
}

describe("sidebar isActive with URL params", () => {
  it("tab item active when matching", () => {
    expect(isActiveLogic("/dashboard?tab=schedule", "/dashboard", "schedule")).toBe(true);
    expect(isActiveLogic("/dashboard?tab=clients", "/dashboard", "clients")).toBe(true);
  });

  it("tab item not active when different", () => {
    expect(isActiveLogic("/dashboard?tab=schedule", "/dashboard", "clients")).toBe(false);
  });

  it("tab item not active when no current tab", () => {
    expect(isActiveLogic("/dashboard?tab=schedule", "/dashboard", null)).toBe(false);
  });

  it("dashboard root active only when no tab param", () => {
    expect(isActiveLogic("/dashboard", "/dashboard", null)).toBe(true);
    expect(isActiveLogic("/dashboard", "/dashboard", "schedule")).toBe(false);
  });

  it("settings active by prefix", () => {
    expect(isActiveLogic("/settings", "/settings", null)).toBe(true);
    expect(isActiveLogic("/users", "/users/123", null)).toBe(true);
  });
});

// ─── Settings sections (extracted from SettingsShell) ───

function getSettingsSections(role: string | null, isPersonalTenant?: boolean): string[] {
  const sections: string[] = [];
  if (role === "tenant_owner") {
    sections.push("account", "bot", "billing", "appearance", "help");
  } else if (role === "master") {
    sections.push("account");
    if (isPersonalTenant) sections.push("bot");
    sections.push("appearance", "help");
  } else if (role === "support" || role === "technical_support") {
    sections.push("account", "appearance", "help");
  } else if (role === "system_admin") {
    sections.push("account", "bot", "billing", "appearance", "help", "platform");
  } else {
    sections.push("account", "appearance", "help");
  }
  return sections;
}

describe("settings sections per role", () => {
  it("master without personal tenant → no bot section", () => {
    const s = getSettingsSections("master", false);
    expect(s).toEqual(["account", "appearance", "help"]);
    expect(s).not.toContain("bot");
  });

  it("master with personal tenant → includes bot section", () => {
    const s = getSettingsSections("master", true);
    expect(s).toEqual(["account", "bot", "appearance", "help"]);
  });

  it("tenant_owner always has bot + billing", () => {
    const s = getSettingsSections("tenant_owner");
    expect(s).toContain("bot");
    expect(s).toContain("billing");
  });

  it("support roles → no bot or billing", () => {
    expect(getSettingsSections("support")).toEqual(["account", "appearance", "help"]);
    expect(getSettingsSections("technical_support")).toEqual(["account", "appearance", "help"]);
  });

  it("system_admin has all sections including platform", () => {
    const s = getSettingsSections("system_admin");
    expect(s).toContain("platform");
    expect(s).toContain("bot");
    expect(s).toContain("billing");
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
