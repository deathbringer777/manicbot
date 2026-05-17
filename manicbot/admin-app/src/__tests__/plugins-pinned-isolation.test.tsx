// @vitest-environment happy-dom
/**
 * Cross-tenant isolation: pins written for tenant A must not be readable
 * under tenant B's context — both at the localStorage cache level and
 * at the hook level (where tRPC is the authoritative source).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// ── Reliable localStorage stub ──────────────────────────────────────────
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

// ── Mutable tenant context ──────────────────────────────────────────────
let mockTenantId: string | null = "t_salon_a";

vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({ tenantId: mockTenantId, role: "tenant_owner" }),
}));

// ── Per-tenant server state (simulates D1 rows filtered by tenantId) ────
const _serverPins: Record<string, string[]> = {};

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        listPinned: {
          cancel: () => Promise.resolve(),
          getData: () => _serverPins[mockTenantId ?? ""] ?? [],
          setData: (_k: unknown, next: string[]) => {
            _serverPins[mockTenantId ?? ""] = next;
          },
          invalidate: () => Promise.resolve(),
        },
      },
    }),
    plugins: {
      listPinned: {
        useQuery: () => ({
          data: _serverPins[mockTenantId ?? ""] ?? [],
          isLoading: false,
        }),
      },
      togglePin: {
        useMutation: (opts: {
          onMutate?: (v: { slug: string }) => Promise<unknown> | unknown;
          onSettled?: () => void;
        }) => ({
          mutate: (v: { slug: string }) => {
            const tid = mockTenantId ?? "";
            const cur = _serverPins[tid] ?? [];
            _serverPins[tid] = cur.includes(v.slug)
              ? cur.filter((s) => s !== v.slug)
              : [v.slug, ...cur].slice(0, 20);
            void opts.onMutate?.(v);
            opts.onSettled?.();
          },
          error: null,
        }),
      },
    },
  },
}));

import { readPinned, writePinned, usePinnedPlugins } from "~/lib/plugins/pinnedPlugins";

beforeEach(() => {
  _mockLocalStorage.clear();
  Object.keys(_serverPins).forEach((k) => delete _serverPins[k]);
  mockTenantId = "t_salon_a";
});
afterEach(() => cleanup());

// ── localStorage helper isolation ────────────────────────────────────────
describe("readPinned / writePinned — per-tenant cache isolation", () => {
  it("uses a tenant-scoped key, not the global fallback key", () => {
    writePinned(["sms"], "t_salon_a");
    expect(_lsStore["manicbot_pinned_plugins_t_salon_a"]).toBeDefined();
    expect(_lsStore["manicbot_pinned_plugins"]).toBeUndefined();
  });

  it("tenant B cannot read tenant A's localStorage cache", () => {
    writePinned(["sms", "crm"], "t_salon_a");
    expect(readPinned("t_salon_b")).toEqual([]);
  });

  it("tenant A cannot read tenant B's localStorage cache", () => {
    writePinned(["loyalty"], "t_salon_b");
    expect(readPinned("t_salon_a")).toEqual([]);
  });

  it("tenants maintain independent lists simultaneously", () => {
    writePinned(["sms"], "t_salon_a");
    writePinned(["crm", "loyalty"], "t_salon_b");
    expect(readPinned("t_salon_a")).toEqual(["sms"]);
    expect(readPinned("t_salon_b")).toEqual(["crm", "loyalty"]);
  });

  it("null tenantId falls back to the unscoped legacy key", () => {
    writePinned(["fallback"]);
    expect(_lsStore["manicbot_pinned_plugins"]).toBeDefined();
    expect(readPinned()).toEqual(["fallback"]);
  });
});

// ── hook isolation (tRPC = authoritative source) ─────────────────────────
describe("usePinnedPlugins — cross-tenant isolation", () => {
  it("pins from tenant A are not visible in tenant B", () => {
    _serverPins["t_salon_a"] = ["sms"];
    mockTenantId = "t_salon_a";
    const { result: rA } = renderHook(() => usePinnedPlugins());
    expect(rA.current.pinned).toContain("sms");

    mockTenantId = "t_salon_b";
    const { result: rB } = renderHook(() => usePinnedPlugins());
    expect(rB.current.pinned).not.toContain("sms");
    expect(rB.current.pinned).toHaveLength(0);
  });

  it("toggling a pin in tenant A does not affect tenant B", async () => {
    mockTenantId = "t_salon_a";
    const { result: rA } = renderHook(() => usePinnedPlugins());
    act(() => rA.current.toggle("crm"));
    await waitFor(() => expect(_serverPins["t_salon_a"]).toContain("crm"));

    mockTenantId = "t_salon_b";
    const { result: rB } = renderHook(() => usePinnedPlugins());
    expect(rB.current.pinned).not.toContain("crm");
  });

  it("server sync mirrors to tenant-scoped localStorage key, not global key", async () => {
    _serverPins["t_salon_a"] = ["task-board"];
    mockTenantId = "t_salon_a";
    renderHook(() => usePinnedPlugins());
    await waitFor(() => {
      expect(_lsStore["manicbot_pinned_plugins_t_salon_a"]).toBeDefined();
    });
    expect(_lsStore["manicbot_pinned_plugins"]).toBeUndefined();
  });

  it("each tenant's localStorage seed key is scoped independently", async () => {
    _serverPins["t_salon_a"] = ["sms"];
    _serverPins["t_salon_b"] = ["crm"];

    mockTenantId = "t_salon_a";
    const { result: rA } = renderHook(() => usePinnedPlugins());
    mockTenantId = "t_salon_b";
    const { result: rB } = renderHook(() => usePinnedPlugins());

    await waitFor(() => {
      expect(_lsStore["manicbot_pinned_plugins_t_salon_a"]).toBeDefined();
      expect(_lsStore["manicbot_pinned_plugins_t_salon_b"]).toBeDefined();
    });

    expect(JSON.parse(_lsStore["manicbot_pinned_plugins_t_salon_a"]!)).toContain("sms");
    expect(JSON.parse(_lsStore["manicbot_pinned_plugins_t_salon_b"]!)).toContain("crm");
    expect(rA.current.pinned).toEqual(["sms"]);
    expect(rB.current.pinned).toEqual(["crm"]);
  });
});
