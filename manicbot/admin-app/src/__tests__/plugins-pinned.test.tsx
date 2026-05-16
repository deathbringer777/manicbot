// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

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
let mockTenantId: string | null = "tenant_default";
vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: mockTenantId }),
}));

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
  _mockLocalStorage.clear();
  mockPinnedData = [];
  mockMutate = () => {};
  mockMutationError = null;
  mockTenantId = "tenant_default";
});

afterEach(() => cleanup());

describe("pinned storage helpers (tenant-scoped localStorage cache)", () => {
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
  it("writePinned persists + fires CustomEvent (global key)", () => {
    writePinned(["sms"]);
    expect(JSON.parse(window.localStorage.getItem("manicbot_pinned_plugins")!)).toEqual(["sms"]);
  });
  it("writePinned with tenantId uses scoped key", () => {
    writePinned(["sms"], "t_salon");
    expect(JSON.parse(window.localStorage.getItem("manicbot_pinned_plugins_t_salon")!)).toEqual(["sms"]);
    expect(window.localStorage.getItem("manicbot_pinned_plugins")).toBeNull();
  });
  it("readPinned with tenantId reads scoped key", () => {
    window.localStorage.setItem("manicbot_pinned_plugins_t_abc", JSON.stringify(["notes"]));
    expect(readPinned("t_abc")).toEqual(["notes"]);
    expect(readPinned()).toEqual([]);
  });
});

describe("cross-tenant isolation — localStorage", () => {
  it("pins written for tenant A are not visible from tenant B", () => {
    writePinned(["sms", "task-board"], "tenant_A");
    writePinned(["export-hub"], "tenant_B");

    expect(readPinned("tenant_A")).toEqual(["sms", "task-board"]);
    expect(readPinned("tenant_B")).toEqual(["export-hub"]);
    expect(readPinned("tenant_B")).not.toContain("sms");
    expect(readPinned("tenant_A")).not.toContain("export-hub");
  });

  it("usePinnedPlugins mirrors server data to the correct tenant-scoped key", async () => {
    mockTenantId = "tenant_X";
    mockPinnedData = ["task-board"];
    renderHook(() => usePinnedPlugins());
    await waitFor(() => {
      const key = "manicbot_pinned_plugins_tenant_X";
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]") as string[];
      expect(stored).toContain("task-board");
      // The global (non-scoped) key must remain untouched
      expect(window.localStorage.getItem("manicbot_pinned_plugins")).toBeNull();
    });
  });

  it("switching tenantId reads from a different localStorage bucket", async () => {
    // Seed two buckets
    window.localStorage.setItem("manicbot_pinned_plugins_tenant_A", JSON.stringify(["sms"]));
    window.localStorage.setItem("manicbot_pinned_plugins_tenant_B", JSON.stringify(["export-hub"]));

    mockTenantId = "tenant_A";
    expect(readPinned(mockTenantId)).toContain("sms");
    expect(readPinned(mockTenantId)).not.toContain("export-hub");

    mockTenantId = "tenant_B";
    expect(readPinned(mockTenantId)).toContain("export-hub");
    expect(readPinned(mockTenantId)).not.toContain("sms");
  });
});

describe("usePinnedPlugins — server-backed (mocked tRPC)", () => {
  it("reads from tRPC query, not localStorage", () => {
    mockTenantId = "tenant_A";
    window.localStorage.setItem("manicbot_pinned_plugins_tenant_A", JSON.stringify(["from-local"]));
    mockPinnedData = ["from-server"];
    const { result } = renderHook(() => usePinnedPlugins());
    expect(result.current.pinned).toEqual(["from-server"]);
  });

  it("mirrors server truth to localStorage for next-paint seeding", async () => {
    mockTenantId = "tenant_A";
    mockPinnedData = ["task-board"];
    renderHook(() => usePinnedPlugins());
    await waitFor(() => {
      const key = "manicbot_pinned_plugins_tenant_A";
      expect(JSON.parse(window.localStorage.getItem(key) ?? "[]")).toEqual(["task-board"]);
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
