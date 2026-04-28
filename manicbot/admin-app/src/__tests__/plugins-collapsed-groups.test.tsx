// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useCollapsedGroups, readCollapsed, writeCollapsed, collapsedGroupsStorageKey } from "~/lib/plugins/collapsedGroups";

// ── Reliable localStorage stub (happy-dom's native implementation is incomplete) ──
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

// ── Mock useRole so tenantId is configurable per test ───────────────────────
let mockTenantId: string | null = null;
vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: mockTenantId }),
}));

beforeEach(() => {
  _mockLocalStorage.clear();
  mockTenantId = null;
});

afterEach(() => cleanup());

describe("useCollapsedGroups", () => {
  it("starts with nothing collapsed", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isCollapsed("overview")).toBe(false);
    expect(result.current.isCollapsed("platform")).toBe(false);
  });

  it("toggle collapses a group", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    act(() => result.current.toggle("platform"));
    expect(result.current.isCollapsed("platform")).toBe(true);
    expect(result.current.isCollapsed("overview")).toBe(false);
  });

  it("toggle twice expands again", () => {
    const { result } = renderHook(() => useCollapsedGroups());
    act(() => result.current.toggle("platform"));
    act(() => result.current.toggle("platform"));
    expect(result.current.isCollapsed("platform")).toBe(false);
  });

  it("persists across mounts via localStorage", () => {
    mockTenantId = "tenant_A";
    writeCollapsed(new Set(["platform"]), "tenant_A");
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isCollapsed("platform")).toBe(true);
  });
});

describe("cross-tenant isolation", () => {
  it("collapsed groups in tenant A don't affect tenant B", () => {
    // Collapse a group as tenant A
    mockTenantId = "tenant_A";
    const { result: resultA } = renderHook(() => useCollapsedGroups());
    act(() => resultA.current.toggle("platform"));
    expect(resultA.current.isCollapsed("platform")).toBe(true);

    // Tenant B should see nothing collapsed
    mockTenantId = "tenant_B";
    const { result: resultB } = renderHook(() => useCollapsedGroups());
    expect(resultB.current.isCollapsed("platform")).toBe(false);
  });

  it("uses separate localStorage keys per tenant", () => {
    writeCollapsed(new Set(["a"]), "tenant_X");
    writeCollapsed(new Set(["b"]), "tenant_Y");

    const xResult = readCollapsed("tenant_X");
    const yResult = readCollapsed("tenant_Y");

    expect(xResult.has("a")).toBe(true);
    expect(xResult.has("b")).toBe(false);
    expect(yResult.has("b")).toBe(true);
    expect(yResult.has("a")).toBe(false);
  });

  it("storage key includes tenantId", () => {
    expect(collapsedGroupsStorageKey("t_abc")).toBe("manicbot_nav_collapsed_groups_t_abc");
    expect(collapsedGroupsStorageKey(null)).toBe("manicbot_nav_collapsed_groups");
    expect(collapsedGroupsStorageKey(undefined)).toBe("manicbot_nav_collapsed_groups");
  });
});

describe("readCollapsed / writeCollapsed — storage", () => {
  it("readCollapsed handles garbage", () => {
    window.localStorage.setItem("manicbot_nav_collapsed_groups", "{bad");
    expect(readCollapsed().size).toBe(0);
  });

  it("writeCollapsed + readCollapsed roundtrip (global key)", () => {
    writeCollapsed(new Set(["a", "b", "c"]));
    const r = readCollapsed();
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(true);
    expect(r.has("c")).toBe(true);
  });

  it("writeCollapsed + readCollapsed roundtrip (tenant-scoped key)", () => {
    writeCollapsed(new Set(["x", "y"]), "t_salon");
    const r = readCollapsed("t_salon");
    expect(r.has("x")).toBe(true);
    expect(r.has("y")).toBe(true);
    // Global key should be unaffected
    expect(readCollapsed().size).toBe(0);
  });
});
