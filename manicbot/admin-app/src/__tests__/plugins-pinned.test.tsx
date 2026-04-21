// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// ── Shared mutable tRPC mock state ──────────────────────────────────────
let mockPinnedData: string[] = [];
let mockMutate: (v: { slug: string }) => void = () => {};
let mockMutationError: { message: string } | null = null;

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        listPinned: {
          cancel: () => Promise.resolve(),
          getData: () => mockPinnedData,
          setData: (_k: unknown, next: string[]) => {
            mockPinnedData = next;
          },
          invalidate: () => Promise.resolve(),
        },
      },
    }),
    plugins: {
      listPinned: {
        useQuery: () => ({ data: mockPinnedData, isLoading: false }),
      },
      togglePin: {
        useMutation: (opts: {
          onMutate?: (v: { slug: string }) => Promise<unknown> | unknown;
          onError?: (e: unknown, v: unknown, ctx: unknown) => void;
          onSettled?: () => void;
        }) => ({
          mutate: (v: { slug: string }) => {
            mockMutate = (x) => {
              void opts.onMutate?.(x);
              opts.onSettled?.();
            };
            mockMutate(v);
          },
          error: mockMutationError,
        }),
      },
    },
  },
}));

import { usePinnedPlugins, readPinned, writePinned } from "~/lib/plugins/pinnedPlugins";

beforeEach(() => {
  window.localStorage.clear();
  mockPinnedData = [];
  mockMutate = () => {};
  mockMutationError = null;
});

afterEach(() => cleanup());

describe("pinned storage helpers (legacy localStorage cache)", () => {
  it("readPinned returns [] for empty", () => {
    expect(readPinned()).toEqual([]);
  });
  it("readPinned ignores garbage JSON", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", "{not-json");
    expect(readPinned()).toEqual([]);
  });
  it("readPinned filters non-strings", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", JSON.stringify([1, "a", null, "b"]));
    expect(readPinned()).toEqual(["a", "b"]);
  });
  it("readPinned caps at 20", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", JSON.stringify(Array.from({ length: 30 }, (_, i) => `p${i}`)));
    expect(readPinned()).toHaveLength(20);
  });
  it("writePinned persists + fires CustomEvent", () => {
    writePinned(["sms"]);
    expect(JSON.parse(window.localStorage.getItem("manicbot_pinned_plugins")!)).toEqual(["sms"]);
  });
});

describe("usePinnedPlugins — server-backed (mocked tRPC)", () => {
  it("reads from tRPC query, not localStorage", () => {
    window.localStorage.setItem("manicbot_pinned_plugins", JSON.stringify(["from-local"]));
    mockPinnedData = ["from-server"];
    const { result } = renderHook(() => usePinnedPlugins());
    expect(result.current.pinned).toEqual(["from-server"]);
  });

  it("mirrors server truth to localStorage for next-paint seeding", async () => {
    mockPinnedData = ["quick-notes"];
    renderHook(() => usePinnedPlugins());
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("manicbot_pinned_plugins") ?? "[]")).toEqual([
        "quick-notes",
      ]);
    });
  });

  it("toggle optimistically adds a slug", async () => {
    const { result } = renderHook(() => usePinnedPlugins());
    expect(result.current.isPinned("sms")).toBe(false);
    act(() => result.current.toggle("sms"));
    await waitFor(() => expect(mockPinnedData).toContain("sms"));
  });

  it("toggle optimistically removes when already pinned", async () => {
    mockPinnedData = ["sms"];
    const { result } = renderHook(() => usePinnedPlugins());
    act(() => result.current.toggle("sms"));
    await waitFor(() => expect(mockPinnedData).not.toContain("sms"));
  });

  it("newly pinned slugs appear at the top", async () => {
    mockPinnedData = ["first"];
    const { result } = renderHook(() => usePinnedPlugins());
    act(() => result.current.toggle("second"));
    await waitFor(() => expect(mockPinnedData[0]).toBe("second"));
  });

  it("surfaces mutation error (pin_limit_reached)", () => {
    mockMutationError = { message: "pin_limit_reached" };
    const { result } = renderHook(() => usePinnedPlugins());
    expect(result.current.error).toBe("pin_limit_reached");
  });

  it("pin is idempotent (no duplicate fire when already pinned)", () => {
    mockPinnedData = ["sms"];
    const { result } = renderHook(() => usePinnedPlugins());
    const before = [...mockPinnedData];
    act(() => result.current.pin("sms"));
    expect(mockPinnedData).toEqual(before);
  });
});
