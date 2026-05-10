// @vitest-environment happy-dom
/**
 * useMasterVisibility — shared per-master visibility state with
 * localStorage persistence under `manicbot_day_view_visible_masters`.
 *
 * Tests pin:
 *   - hidden ids initialize from localStorage on first render,
 *   - toggle adds → removes → adds with correct Set semantics,
 *   - showAllMasters resets to empty,
 *   - storage write is idempotent on identical state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMasterVisibility } from "~/lib/useMasterVisibility";

const KEY = "manicbot_day_view_visible_masters";

beforeEach(() => {
  // Provide a deterministic in-memory localStorage stub. happy-dom's
  // built-in is shared per file so initial state would leak across tests.
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

describe("useMasterVisibility", () => {
  it("starts with an empty hidden set when localStorage is empty", () => {
    const { result } = renderHook(() => useMasterVisibility());
    expect(result.current.hiddenMasterIds.size).toBe(0);
  });

  it("hydrates the hidden set from localStorage on mount", () => {
    localStorage.setItem(KEY, JSON.stringify([100, 200]));
    const { result } = renderHook(() => useMasterVisibility());
    expect(result.current.hiddenMasterIds.has(100)).toBe(true);
    expect(result.current.hiddenMasterIds.has(200)).toBe(true);
    expect(result.current.hiddenMasterIds.has(300)).toBe(false);
  });

  it("toggleMasterVisible adds + removes a chatId", () => {
    const { result } = renderHook(() => useMasterVisibility());
    act(() => result.current.toggleMasterVisible(100));
    expect(result.current.hiddenMasterIds.has(100)).toBe(true);
    act(() => result.current.toggleMasterVisible(100));
    expect(result.current.hiddenMasterIds.has(100)).toBe(false);
  });

  it("toggleMasterVisible persists the new state to localStorage", () => {
    const { result } = renderHook(() => useMasterVisibility());
    act(() => result.current.toggleMasterVisible(100));
    act(() => result.current.toggleMasterVisible(200));
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.sort()).toEqual([100, 200]);
  });

  it("showAllMasters resets the set and clears storage", () => {
    localStorage.setItem(KEY, JSON.stringify([100, 200, 300]));
    const { result } = renderHook(() => useMasterVisibility());
    expect(result.current.hiddenMasterIds.size).toBe(3);
    act(() => result.current.showAllMasters());
    expect(result.current.hiddenMasterIds.size).toBe(0);
    expect(localStorage.getItem(KEY)).toBe("[]");
  });

  it("ignores malformed localStorage payloads (returns empty set)", () => {
    localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => useMasterVisibility());
    expect(result.current.hiddenMasterIds.size).toBe(0);
  });

  it("filters out non-numeric ids from localStorage", () => {
    localStorage.setItem(KEY, JSON.stringify([100, "200", null, 300]));
    const { result } = renderHook(() => useMasterVisibility());
    expect(result.current.hiddenMasterIds.has(100)).toBe(true);
    expect(result.current.hiddenMasterIds.has(300)).toBe(true);
    expect(result.current.hiddenMasterIds.size).toBe(2);
  });
});
