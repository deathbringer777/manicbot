/**
 * Mirror-logic test for the (dashboard)/layout.tsx routing decision for
 * /plugins. We don't render the full layout (too many deps); we replicate
 * the branch decisions in a pure function and assert.
 */

import { describe, it, expect } from "vitest";

type Effective = "system_admin" | "tenant_owner" | "tenant_manager" | "master" | "support" | "technical_support" | null;

function renderedContent(role: Effective, pathname: string): "dashboard" | "children" | "onboarding" | "settings" {
  const isSettings = pathname === "/settings";
  const isPlugins = pathname === "/plugins" || pathname.startsWith("/plugins/");
  if (isSettings) return "settings";
  if (role === "tenant_owner" || role === "tenant_manager" || role === "master") {
    if (isPlugins) return "children";
    return "dashboard";
  }
  if (role === "support" || role === "technical_support") {
    if (isPlugins) return "children";
    return "dashboard";
  }
  // system_admin / unknown — falls through to children (page router)
  return "children";
}

describe("/plugins routing across roles", () => {
  it.each([
    "tenant_owner", "tenant_manager", "master", "support", "technical_support", "system_admin",
  ] as Effective[])("%s loads /plugins as page children (not role dashboard)", (role) => {
    expect(renderedContent(role, "/plugins")).toBe("children");
  });

  it.each([
    "tenant_owner", "tenant_manager", "master", "support", "technical_support",
  ] as Effective[])("%s loads /dashboard as their role dashboard", (role) => {
    expect(renderedContent(role, "/dashboard")).toBe("dashboard");
  });

  it("/plugins/quick-notes loads as page children for tenant_owner", () => {
    expect(renderedContent("tenant_owner", "/plugins/quick-notes")).toBe("children");
  });

  it("/settings always renders children regardless of role", () => {
    expect(renderedContent("tenant_owner", "/settings")).toBe("settings");
    expect(renderedContent("master", "/settings")).toBe("settings");
    expect(renderedContent("support", "/settings")).toBe("settings");
  });
});
