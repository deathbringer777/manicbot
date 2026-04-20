// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useCollapsedGroups, readCollapsed, writeCollapsed } from "~/lib/plugins/collapsedGroups";

beforeEach(() => {
  window.localStorage.clear();
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
    writeCollapsed(new Set(["platform"]));
    const { result } = renderHook(() => useCollapsedGroups());
    expect(result.current.isCollapsed("platform")).toBe(true);
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
});
