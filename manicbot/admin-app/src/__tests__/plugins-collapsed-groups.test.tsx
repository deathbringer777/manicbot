// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import React from "react";
import { useCollapsedGroups, readCollapsed, writeCollapsed } from "~/lib/plugins/collapsedGroups";
import { RoleContext } from "~/components/RoleContext";
import type { RoleContextValue } from "~/components/RoleContext";

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

beforeEach(() => {
  _mockLocalStorage.clear();
});

afterEach(() => cleanup());

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
    writeCollapsed(new Set(["platform"]));
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isCollapsed("platform")).toBe(true);
  });
});

describe("useCollapsedGroups — tenant isolation", () => {
  it("collapse in tenant A does not appear in tenant B", () => {
    const { result: a } = renderHook(() => useCollapsedGroups(), {
      wrapper: makeWrapper("t_a"),
    });
    act(() => a.current.toggle("platform"));
    expect(a.current.isCollapsed("platform")).toBe(true);

    const { result: b } = renderHook(() => useCollapsedGroups(), {
      wrapper: makeWrapper("t_b"),
    });
    expect(b.current.isCollapsed("platform")).toBe(false);
  });

  it("each tenant gets its own localStorage key", () => {
    writeCollapsed(new Set(["section1"]), "t_a");
    writeCollapsed(new Set(["section2"]), "t_b");

    expect(readCollapsed("t_a").has("section1")).toBe(true);
    expect(readCollapsed("t_a").has("section2")).toBe(false);
    expect(readCollapsed("t_b").has("section2")).toBe(true);
    expect(readCollapsed("t_b").has("section1")).toBe(false);
  });

  it("null tenantId falls back to unscoped key", () => {
    writeCollapsed(new Set(["shared"]), null);
    expect(_lsStore["manicbot_nav_collapsed_groups"]).toBeDefined();
    expect(_lsStore["manicbot_nav_collapsed_groups_null"]).toBeUndefined();
  });
});

describe("readCollapsed / writeCollapsed — storage", () => {
  it("readCollapsed handles garbage", () => {
    window.localStorage.setItem("manicbot_nav_collapsed_groups", "{bad");
    expect(readCollapsed().size).toBe(0);
  });

  it("writeCollapsed + readCollapsed roundtrip", () => {
    writeCollapsed(new Set(["a", "b", "c"]));
    const r = readCollapsed();
    expect(r.has("a")).toBe(true);
    expect(r.has("b")).toBe(true);
    expect(r.has("c")).toBe(true);
  });

  it("writeCollapsed + readCollapsed roundtrip with tenantId", () => {
    writeCollapsed(new Set(["x", "y"]), "t_xyz");
    const r = readCollapsed("t_xyz");
    expect(r.has("x")).toBe(true);
    expect(r.has("y")).toBe(true);
    expect(readCollapsed("t_other").size).toBe(0);
  });
});
