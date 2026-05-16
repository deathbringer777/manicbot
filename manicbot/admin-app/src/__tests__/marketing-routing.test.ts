import { describe, it, expect } from "vitest";

/**
 * Tests for the dashboard layout's path-whitelist logic that decides whether
 * `{children}` (page.tsx) renders OR a role-specific dashboard takes over.
 *
 * Background: prior to PR 1 of the marketing roadmap, `/marketing/*` was
 * intercepted by SalonDashboard for `tenant_owner`/`tenant_manager` — the
 * page.tsx never rendered. This whitelist fix is what unblocks the marketing
 * shell from showing for those roles.
 *
 * Mirrors the dashboard-routing.test.ts pattern: extract the logic as pure
 * functions so we can test independently of React + Next routing.
 */

function isWhitelistedPath(pathname: string): boolean {
  const isSettingsPage = pathname === "/settings";
  const isPluginsPage =
    pathname === "/plugins" ||
    pathname.startsWith("/plugins/") ||
    pathname.startsWith("/plugin/");
  const isMarketingPage =
    pathname === "/marketing" || pathname.startsWith("/marketing/");
  return isSettingsPage || isPluginsPage || isMarketingPage;
}

describe("dashboard layout path whitelist", () => {
  it("settings is whitelisted", () => {
    expect(isWhitelistedPath("/settings")).toBe(true);
  });

  it("plugins (catalog + detail + runtime) are whitelisted", () => {
    expect(isWhitelistedPath("/plugins")).toBe(true);
    expect(isWhitelistedPath("/plugins/loyalty-stamps")).toBe(true);
    expect(isWhitelistedPath("/plugin/loyalty-stamps")).toBe(true);
  });

  it("marketing root is whitelisted", () => {
    expect(isWhitelistedPath("/marketing")).toBe(true);
  });

  it("marketing sub-pages are whitelisted", () => {
    expect(isWhitelistedPath("/marketing/contacts")).toBe(true);
    expect(isWhitelistedPath("/marketing/campaigns")).toBe(true);
    expect(isWhitelistedPath("/marketing/sms")).toBe(true);
    expect(isWhitelistedPath("/marketing/templates")).toBe(true);
    expect(isWhitelistedPath("/marketing/automations")).toBe(true);
    expect(isWhitelistedPath("/marketing/providers")).toBe(true);
  });

  it("dashboard tabs are NOT whitelisted (SalonDashboard takes over)", () => {
    expect(isWhitelistedPath("/dashboard")).toBe(false);
    expect(isWhitelistedPath("/dashboard?tab=appointments")).toBe(false);
    expect(isWhitelistedPath("/")).toBe(false);
  });

  it("non-marketing paths starting with similar prefix are not accidentally matched", () => {
    expect(isWhitelistedPath("/market")).toBe(false);
    expect(isWhitelistedPath("/marketingsomething")).toBe(false); // no trailing slash, so doesn't match `/marketing/`
    // But `/marketingextra` starts with "/marketing" so IS whitelisted —
    // that's a known property of the existing prefix check (mirrors how
    // /plugins handles it). Documenting it here so a future change is
    // intentional.
  });
});

/**
 * Verifies the role × pathname matrix for marketing access. The router-level
 * guard in `marketingTenant.ts` enforces tenant boundary; this test ensures
 * the layout doesn't intercept the page before the router can answer.
 */
type RouteOutcome =
  | "marketing_page" // page.tsx renders
  | "salon_dashboard"
  | "master_dashboard"
  | "support_dashboard"
  | "god_mode";

function resolveRouteOutcome(
  role: string,
  pathname: string,
): RouteOutcome {
  const whitelisted = isWhitelistedPath(pathname);
  if (role === "tenant_owner" || role === "tenant_manager") {
    return whitelisted ? "marketing_page" : "salon_dashboard";
  }
  if (role === "master") {
    return whitelisted ? "marketing_page" : "master_dashboard";
  }
  if (role === "support" || role === "technical_support") {
    return whitelisted ? "marketing_page" : "support_dashboard";
  }
  if (role === "system_admin") {
    return "god_mode";
  }
  return "salon_dashboard";
}

describe("role × pathname routing for /marketing", () => {
  it("tenant_owner on /marketing → page.tsx (not SalonDashboard)", () => {
    expect(resolveRouteOutcome("tenant_owner", "/marketing")).toBe("marketing_page");
  });

  it("tenant_owner on /marketing/contacts → page.tsx", () => {
    expect(resolveRouteOutcome("tenant_owner", "/marketing/contacts")).toBe("marketing_page");
  });

  it("tenant_owner on /dashboard → SalonDashboard (unchanged)", () => {
    expect(resolveRouteOutcome("tenant_owner", "/dashboard")).toBe("salon_dashboard");
  });

  it("tenant_manager on /marketing → page.tsx", () => {
    expect(resolveRouteOutcome("tenant_manager", "/marketing")).toBe("marketing_page");
  });

  it("personal master on /marketing → page.tsx (router enforces personal-tenant guard)", () => {
    // Note: layout permits render; assertTenantOwner inside the router will
    // verify the master is on their personal tenant before returning data.
    expect(resolveRouteOutcome("master", "/marketing")).toBe("marketing_page");
  });

  it("support on /marketing → page.tsx (router returns FORBIDDEN, but layout doesn't block)", () => {
    // Support staff aren't supposed to visit /marketing, but if they do, the
    // tRPC layer answers FORBIDDEN rather than the layout intercepting.
    expect(resolveRouteOutcome("support", "/marketing")).toBe("marketing_page");
  });
});

/**
 * useMarketingScope picks which router to call (`api.marketing.*` for God
 * Mode global, `api.marketingTenant.*` for tenant-scoped) based on role +
 * preview state. Same pure-function pattern.
 */
type MarketingScope = { mode: "admin" | "tenant"; tenantId: string | null };

function pickScope(
  role: string | null,
  tenantId: string | null,
  previewRole: string | null,
  previewTenantId: string | null,
): MarketingScope {
  if (role === "system_admin" && !previewRole) {
    return { mode: "admin", tenantId: null };
  }
  const effective =
    role === "system_admin" && previewTenantId ? previewTenantId : tenantId;
  return { mode: "tenant", tenantId: effective ?? null };
}

describe("useMarketingScope: router selection", () => {
  it("system_admin no preview → admin mode, no tenantId", () => {
    expect(pickScope("system_admin", null, null, null)).toEqual({
      mode: "admin",
      tenantId: null,
    });
  });

  it("tenant_owner → tenant mode with own tenantId", () => {
    expect(pickScope("tenant_owner", "t_a", null, null)).toEqual({
      mode: "tenant",
      tenantId: "t_a",
    });
  });

  it("tenant_manager → tenant mode with own tenantId", () => {
    expect(pickScope("tenant_manager", "t_b", null, null)).toEqual({
      mode: "tenant",
      tenantId: "t_b",
    });
  });

  it("master → tenant mode (personal tenant gates inside router)", () => {
    expect(pickScope("master", "t_personal", null, null)).toEqual({
      mode: "tenant",
      tenantId: "t_personal",
    });
  });

  it("sysadmin previewing tenant_owner → tenant mode with previewTenantId", () => {
    expect(
      pickScope("system_admin", null, "tenant_owner", "t_preview"),
    ).toEqual({ mode: "tenant", tenantId: "t_preview" });
  });

  it("sysadmin previewing without tenantId selected → tenant mode but null tenantId", () => {
    // Component-level guard via `enabled: !!tenantId` keeps queries from firing.
    expect(pickScope("system_admin", null, "tenant_owner", null)).toEqual({
      mode: "tenant",
      tenantId: null,
    });
  });
});
