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

function makeWrapper(tenantId: string | null) {
  const value: RoleContextValue = {
    role: "tenant_owner",
    tenantId,
    tenantName: null,
    userId: null,
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
    setPreviewMaster: () => {},
  };
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(RoleContext.Provider, { value }, children);
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
    const prefs = { hiddenTabs: ["billing"], showTodayApts: false, defaultTab: "overview" };
    saveDashboardPrefs(prefs, "t_a");
    const loaded = loadDashboardPrefs("t_a");
    expect(loaded.hiddenTabs).toEqual(["billing"]);
    expect(loaded.showTodayApts).toBe(false);
  });

  it("tenant A prefs don't bleed into tenant B", () => {
    const prefs = { hiddenTabs: ["services"], showTodayApts: true, defaultTab: "overview" };
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

  it("each tenant writes to its own localStorage key", async () => {
    const { result: a } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper("t_a") });
    act(() => a.current.toggleTab("services"));
    await waitFor(() => expect(a.current.prefs.hiddenTabs).toContain("services"));

    expect(_lsStore["manicbot_dashboard_prefs_t_a"]).toBeDefined();
    expect(_lsStore["manicbot_dashboard_prefs_t_b"]).toBeUndefined();
    expect(_lsStore["manicbot_dashboard_prefs"]).toBeUndefined();
  });

  it("null tenantId falls back to unscoped key", async () => {
    const { result } = renderHook(() => useDashboardPrefs(), { wrapper: makeWrapper(null) });
    act(() => result.current.toggleTab("clients"));
    await waitFor(() => expect(result.current.prefs.hiddenTabs).toContain("clients"));

    expect(_lsStore["manicbot_dashboard_prefs"]).toBeDefined();
    expect(_lsStore["manicbot_dashboard_prefs_null"]).toBeUndefined();
  });
});
