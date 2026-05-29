// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadDashboardPrefs,
  saveDashboardPrefs,
  dashboardPrefsKey,
  BOTTOM_NAV_LIMIT,
} from "~/lib/useDashboardPrefs";

const TENANT = "t_demo";

// happy-dom's built-in localStorage is unreliable across Node versions —
// stub a deterministic in-memory store (mirrors useMasterVisibility.test.ts).
beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useDashboardPrefs — bottom-nav additions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ships with bottomNavLayout='default' and an empty order", () => {
    const prefs = loadDashboardPrefs(TENANT);
    expect(prefs.bottomNavLayout).toBe("default");
    expect(prefs.bottomNavOrder).toEqual([]);
  });

  it("merges new fields into older localStorage payloads without crashing", () => {
    // Older write without the new keys — simulates a user upgrading
    // from before this PR.
    localStorage.setItem(
      dashboardPrefsKey(TENANT),
      JSON.stringify({ hiddenTabs: ["billing"], showTodayApts: true, defaultTab: "overview" }),
    );

    const prefs = loadDashboardPrefs(TENANT);
    expect(prefs.hiddenTabs).toEqual(["billing"]);
    expect(prefs.bottomNavLayout).toBe("default");
    expect(prefs.bottomNavOrder).toEqual([]);
  });

  it("BOTTOM_NAV_LIMIT is the documented cap", () => {
    expect(BOTTOM_NAV_LIMIT).toBe(5);
  });

  it("persists a saved bottom-nav payload and reads it back", () => {
    const order = ["/dashboard?tab=appointments", "/dashboard?tab=clients", "/dashboard?tab=billing"];
    saveDashboardPrefs(
      {
        hiddenTabs: [],
        showTodayApts: true,
        defaultTab: "overview",
        tabOrder: [],
        pinnedTabs: [],
        bottomNavOrder: order,
        bottomNavLayout: "custom",
      },
      TENANT,
    );

    const prefs = loadDashboardPrefs(TENANT);
    expect(prefs.bottomNavLayout).toBe("custom");
    expect(prefs.bottomNavOrder).toEqual(order);
  });

  it("storage key is tenant-scoped — no bleed across tenants", () => {
    expect(dashboardPrefsKey("t_a")).toBe("manicbot_dashboard_prefs_t_a");
    expect(dashboardPrefsKey("t_b")).toBe("manicbot_dashboard_prefs_t_b");
    expect(dashboardPrefsKey(null)).toBe("manicbot_dashboard_prefs");
  });
});

// Hook behaviour is exercised by a separate test that mounts a tiny
// consumer — kept in a dedicated file so the pure helpers above don't
// need a React renderer.
import { renderHook, act } from "@testing-library/react";
import { useDashboardPrefs } from "~/lib/useDashboardPrefs";

const TEST_PROFILE_UID = "owner-uid";
const TEST_PROFILE_KEY = `u${TEST_PROFILE_UID}`;

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({
    tenantId: TENANT,
    webUserId: TEST_PROFILE_UID,
  }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    webUsers: {
      getMyUiPrefs: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
      setMyUiPrefs: {
        useMutation: () => ({ mutate: () => undefined }),
      },
    },
  },
}));

describe("useDashboardPrefs — bottom-nav setters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("setBottomNav switches layout to 'custom' and persists the order", () => {
    const { result } = renderHook(() => useDashboardPrefs());

    act(() => {
      result.current.setBottomNav([
        "/dashboard?tab=appointments",
        "/dashboard?tab=clients",
      ]);
    });

    expect(result.current.prefs.bottomNavLayout).toBe("custom");
    expect(result.current.prefs.bottomNavOrder).toEqual([
      "/dashboard?tab=appointments",
      "/dashboard?tab=clients",
    ]);
    // Round-trip through localStorage (profile-scoped key now)
    expect(loadDashboardPrefs(TENANT, TEST_PROFILE_KEY).bottomNavOrder).toHaveLength(2);
  });

  it("setBottomNav dedupes and clamps to BOTTOM_NAV_LIMIT", () => {
    const { result } = renderHook(() => useDashboardPrefs());

    act(() => {
      result.current.setBottomNav([
        "/a",
        "/b",
        "/a", // duplicate
        "/c",
        "/d",
        "/e",
        "/f", // over the cap
      ]);
    });

    expect(result.current.prefs.bottomNavOrder).toEqual(["/a", "/b", "/c", "/d", "/e"]);
    expect(result.current.prefs.bottomNavOrder).toHaveLength(BOTTOM_NAV_LIMIT);
  });

  it("setBottomNav ignores non-string entries", () => {
    const { result } = renderHook(() => useDashboardPrefs());

    act(() => {
      result.current.setBottomNav(["/a", "", null as unknown as string, "/b"]);
    });

    expect(result.current.prefs.bottomNavOrder).toEqual(["/a", "/b"]);
  });

  it("resetBottomNav switches back to 'default' and clears the order", () => {
    const { result } = renderHook(() => useDashboardPrefs());

    act(() => {
      result.current.setBottomNav(["/a", "/b", "/c"]);
    });
    expect(result.current.prefs.bottomNavLayout).toBe("custom");

    act(() => {
      result.current.resetBottomNav();
    });
    expect(result.current.prefs.bottomNavLayout).toBe("default");
    expect(result.current.prefs.bottomNavOrder).toEqual([]);
  });
});
