import { describe, it, expect } from "vitest";

/**
 * Mirror of `marketing-routing.test.ts` for `/messages`. The path-whitelist
 * lives in `(dashboard)/layout.tsx` (4 mirror blocks: tenant_owner /
 * tenant_manager / master / support+technical_support). Whitelisted paths
 * render page.tsx; non-whitelisted paths get intercepted by the role
 * dashboard. Replicating the logic here as a pure function lets us assert
 * the rule without booting React + Next routing.
 */

function isWhitelistedPath(pathname: string): boolean {
  const isSettingsPage = pathname === "/settings";
  const isPluginsPage =
    pathname === "/plugins" ||
    pathname.startsWith("/plugins/") ||
    pathname.startsWith("/plugin/");
  const isMarketingPage =
    pathname === "/marketing" || pathname.startsWith("/marketing/");
  const isMessagesPage =
    pathname === "/messages" || pathname.startsWith("/messages/");
  return isSettingsPage || isPluginsPage || isMarketingPage || isMessagesPage;
}

describe("dashboard layout whitelist — /messages", () => {
  it("/messages root is whitelisted", () => {
    expect(isWhitelistedPath("/messages")).toBe(true);
  });

  it("/messages/abc-thread is whitelisted", () => {
    // We don't currently route to sub-paths, but the prefix check must allow
    // future expansion (e.g. /messages/{threadId} deep-links).
    expect(isWhitelistedPath("/messages/thread_01HABCDEFGHJKMNPQRSTVWXYZ")).toBe(true);
  });

  it("dashboard tabs are NOT whitelisted (SalonDashboard takes over)", () => {
    expect(isWhitelistedPath("/dashboard")).toBe(false);
    expect(isWhitelistedPath("/dashboard?tab=messages")).toBe(false);
  });

  it("paths starting with similar prefix don't accidentally match", () => {
    expect(isWhitelistedPath("/mess")).toBe(false);
    expect(isWhitelistedPath("/messaging")).toBe(false); // no trailing slash
  });

  it("co-exists with the other three whitelisted modules", () => {
    expect(isWhitelistedPath("/settings")).toBe(true);
    expect(isWhitelistedPath("/plugins")).toBe(true);
    expect(isWhitelistedPath("/marketing")).toBe(true);
    expect(isWhitelistedPath("/messages")).toBe(true);
  });
});

type RouteOutcome =
  | "messages_page" // page.tsx renders
  | "salon_dashboard"
  | "master_dashboard"
  | "support_dashboard"
  | "god_mode";

function resolveRouteOutcome(role: string, pathname: string): RouteOutcome {
  const whitelisted = isWhitelistedPath(pathname);
  if (role === "tenant_owner" || role === "tenant_manager") {
    return whitelisted ? "messages_page" : "salon_dashboard";
  }
  if (role === "master") {
    return whitelisted ? "messages_page" : "master_dashboard";
  }
  if (role === "support" || role === "technical_support") {
    return whitelisted ? "messages_page" : "support_dashboard";
  }
  if (role === "system_admin") {
    return "god_mode";
  }
  return "salon_dashboard";
}

describe("role × pathname routing for /messages", () => {
  it("tenant_owner on /messages → page.tsx (not SalonDashboard)", () => {
    expect(resolveRouteOutcome("tenant_owner", "/messages")).toBe("messages_page");
  });

  it("tenant_manager on /messages → page.tsx", () => {
    expect(resolveRouteOutcome("tenant_manager", "/messages")).toBe("messages_page");
  });

  it("master on /messages → page.tsx", () => {
    expect(resolveRouteOutcome("master", "/messages")).toBe("messages_page");
  });

  it("support on /messages → page.tsx (router will FORBID inside)", () => {
    expect(resolveRouteOutcome("support", "/messages")).toBe("messages_page");
  });

  it("tenant_owner on /dashboard → SalonDashboard (unchanged)", () => {
    expect(resolveRouteOutcome("tenant_owner", "/dashboard")).toBe("salon_dashboard");
  });
});
