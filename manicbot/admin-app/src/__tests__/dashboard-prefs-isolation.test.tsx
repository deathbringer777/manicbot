// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import React from "react";

const _lsStore: Record<string, string> = {};
const _mockLocalStorage = {
  getItem: (key: string) => _lsStore[key] ?? null,
  setItem: (key: string, value: string) => { _lsStore[key] = String(value); },
  removeItem: (key: string) => { delete _lsStore[key]; },
  clear: () => { Object.keys(_lsStore).forEach((k) => delete _lsStore[k]); },
  get length() { return Object.keys(_lsStore).length; },
  key: (n: number) => Object.keys(_lsStore)[n] ?? null,
};
beforeAll(() => { vi.stubGlobal("localStorage", _mockLocalStorage); });
beforeEach(() => { _mockLocalStorage.clear(); });
afterEach(() => cleanup());

import { RoleContext } from "~/components/RoleContext";
import type { RoleContextValue } from "~/components/RoleContext";
import { useDashboardPrefs, loadDashboardPrefs, saveDashboardPrefs, dashboardPrefsKey } from "~/lib/useDashboardPrefs";
import { api } from "~/trpc/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import SuperJSON from "superjson";

function makeWrapper(tenantId: string | null, webUserId: string | null = "owner-uid") {
  const value: RoleContextValue = {
    role: "tenant_owner",
    tenantId,
    tenantName: null,
        tenantLogo: null,
        masterAvatarUrl: null,
        masterAvatarEmoji: null,
    userId: null,
    webUserId,
    createdAt: null,
    hasPassword: true,
    emailVerified: true,
    isPersonalTenant: false,
    permissions: [],
    billingStatus: "active",
    isTrialExpired: false,
    previewRole: null,
    previewTenantId: null,
    setPreviewRole: () => {},
    previewMasterId: null,
    previewMasterWebUserId: null,
    setPreviewMaster: () => {},
  };
  // useDashboardPrefs now calls api.webUsers.getMyUiPrefs.useQuery so we need
  // a real tRPC + react-query provider. The link target is unreachable
  // (`http://test.invalid`) — the test only cares about local-storage and
  // helper logic, and `retry: false` in the hook means the failed fetch
  // doesn't loop.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const trpcClient = api.createClient({
    links: [httpBatchLink({ url: "http://test.invalid/api/trpc", transformer: SuperJSON })],
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <api.Provider client={trpcClient} queryClient={queryClient}>
          <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
        </api.Provider>
      </QueryClientProvider>
    );
  };
}

describe("dashboardPrefsKey", () => {
  it("includes tenantId in key", () => {
    expect(dashboardPrefsKey("t_abc")).toBe("manicbot_dashboard_prefs_t_abc");
  });
  it("falls back to unscoped key when tenantId is null", () => {
    expect(dashboardPrefsKey(null)).toBe("manicbot_dashboard_prefs");
    expect(dashboardPrefsKey(undefined)).toBe("manicbot_dashboard_prefs");
  });
});

describe("loadDashboardPrefs / saveDashboardPrefs", () => {
  it("roundtrip with tenantId", () => {
    const prefs = {
      hiddenTabs: ["billing"],
      showTodayApts: false,
      defaultTab: "overview",
      tabOrder: [],
      pinnedTabs: [],
      bottomNavOrder: [],
      bottomNavLayout: "default" as const,
    };
    saveDashboardPrefs(prefs, "t_a");
    const loaded = loadDashboardPrefs("t_a");
    expect(loaded.hiddenTabs).toEqual(["billing"]);
    expect(loaded.showTodayApts).toBe(false);
  });

  it("tenant A prefs don't bleed into tenant B", () => {
    const prefs = {
      hiddenTabs: ["services"],
      showTodayApts: true,
      defaultTab: "overview",
      tabOrder: [],
      pinnedTabs: [],
      bottomNavOrder: [],
      bottomNavLayout: "default" as const,
    };
    saveDashboardPrefs(prefs, "t_a");
    const b = loadDashboardPrefs("t_b");
    expect(b.hiddenTabs).toEqual([]);
  });
});

describe("useDashboardPrefs — tenant isolation", () => {
  it("hidden tab for tenant A is not visible for tenant B", async () => {
    const { result: a } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_a") });

    act(() => a.current.toggleTab("billing"));
    await waitFor(() => expect(a.current.prefs.hiddenTabs).toContain("billing"));

    const { result: b } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_b") });
    expect(b.current.prefs.hiddenTabs).not.toContain("billing");
  });

  it("each tenant writes to its own profile-scoped localStorage key", async () => {
    const { result: a } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_a") });
    act(() => a.current.toggleTab("services"));
    await waitFor(() => expect(a.current.prefs.hiddenTabs).toContain("services"));

    // Profile-scoped key format: <prefix>_<tenant>_u<webUserId>
    expect(_lsStore["manicbot_dashboard_prefs_t_a_uowner-uid"]).toBeDefined();
    expect(_lsStore["manicbot_dashboard_prefs_t_b_uowner-uid"]).toBeUndefined();
    expect(_lsStore["manicbot_dashboard_prefs"]).toBeUndefined();
  });

  it("null tenantId falls back to unscoped key", async () => {
    const { result } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper(null) });
    act(() => result.current.toggleTab("clients"));
    await waitFor(() => expect(result.current.prefs.hiddenTabs).toContain("clients"));

    expect(_lsStore["manicbot_dashboard_prefs"]).toBeDefined();
    expect(_lsStore["manicbot_dashboard_prefs_null"]).toBeUndefined();
  });

  it("two different web users on the same tenant get isolated prefs", async () => {
    const { result: u1 } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_a", "user-1") });
    act(() => u1.current.toggleTab("billing"));
    await waitFor(() => expect(u1.current.prefs.hiddenTabs).toContain("billing"));

    const { result: u2 } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_a", "user-2") });
    expect(u2.current.prefs.hiddenTabs).not.toContain("billing");

    expect(_lsStore["manicbot_dashboard_prefs_t_a_uuser-1"]).toBeDefined();
    expect(_lsStore["manicbot_dashboard_prefs_t_a_uuser-2"]).toBeUndefined();
  });

  it("migrates legacy tenant-only key into profile-scoped key on first mount", async () => {
    // Seed legacy key (pre-migration value).
    const legacyPrefs = {
      hiddenTabs: ["billing"],
      showTodayApts: false,
      defaultTab: "overview",
      bottomNavOrder: ["/clients", "/services"],
      bottomNavLayout: "custom" as const,
    };
    _lsStore["manicbot_dashboard_prefs_t_a"] = JSON.stringify(legacyPrefs);

    const { result } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_a", "owner-uid") });
    await waitFor(() => expect(result.current.prefs.hiddenTabs).toContain("billing"));

    // New key now holds the migrated payload AND legacy key is gone so a
    // second web-user can't accidentally inherit it.
    expect(_lsStore["manicbot_dashboard_prefs_t_a_uowner-uid"]).toBeDefined();
    expect(_lsStore["manicbot_dashboard_prefs_t_a"]).toBeUndefined();
    expect(result.current.prefs.bottomNavOrder).toEqual(["/clients", "/services"]);
    expect(result.current.prefs.bottomNavLayout).toBe("custom");
  });
});
