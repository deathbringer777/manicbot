// @vitest-environment happy-dom
/**
 * PinnedNavSection behaviour in «view as master» preview mode.
 *
 *  - Real master (has web_users row): pin/unpin buttons are HIDDEN. Owner
 *    sees the master's pins as read-only — clicking a pin link still
 *    navigates, but no pinning UI is exposed.
 *  - Synthetic master (no web_users row): a dedicated empty-state card
 *    explains that the master hasn't signed in yet. Owner's own pins
 *    must NOT leak in.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

let mockPinned: string[] = [];
let mockPathname: string = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// Mutable preview state
let mockPreviewMasterId: number | null = null;
let mockPreviewMasterWebUserId: string | null = null;
vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({
    tenantId: "t_demo",
    role: "tenant_owner",
    webUserId: "owner-uid",
    previewMasterId: mockPreviewMasterId,
    previewMasterWebUserId: mockPreviewMasterWebUserId,
  }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        listPinned: {
          cancel: () => Promise.resolve(),
          getData: () => mockPinned,
          setData: () => {},
          invalidate: () => Promise.resolve(),
        },
      },
    }),
    plugins: {
      listPinned: {
        useQuery: () => ({ data: mockPinned, isLoading: false }),
      },
      togglePin: {
        useMutation: () => ({ mutate: () => {}, error: null }),
      },
    },
  },
}));

import { PinnedNavSection } from "~/components/layout/PinnedNavSection";

beforeEach(() => {
  mockPinned = [];
  mockPathname = "/dashboard";
  mockPreviewMasterId = null;
  mockPreviewMasterWebUserId = null;
});

afterEach(() => cleanup());

describe("PinnedNavSection — preview-as-master", () => {
  it("synthetic master preview renders empty-state card and hides owner pins", () => {
    // Owner has pinned things, but in preview we should NOT see them.
    mockPinned = ["loyalty-stamps", "message-templates"];
    mockPreviewMasterId = 4242;
    mockPreviewMasterWebUserId = null; // synthetic
    renderWithLang(<PinnedNavSection />);
    expect(screen.getByTestId("pinned-nav-synthetic-preview")).toBeDefined();
    // Owner's own pins must not render in this branch — the leak the
    // original bug exhibited.
    expect(screen.queryByTestId("pinned-nav-item")).toBeNull();
  });

  it("real-master preview shows master's pins but suppresses pin/unpin buttons", () => {
    mockPinned = ["loyalty-stamps"];
    mockPreviewMasterId = 5555;
    mockPreviewMasterWebUserId = "master-uid";
    renderWithLang(<PinnedNavSection />);
    // Master's pin row is visible (read-only navigation)
    const row = screen.getByTestId("pinned-nav-item");
    expect(row.getAttribute("data-slug")).toBe("loyalty-stamps");
    // ... but no Pin or Unpin buttons are exposed
    expect(screen.queryByTitle("Открепить")).toBeNull();
    expect(screen.queryByTitle("Закрепить")).toBeNull();
  });

  it("transient open-plugin row does not expose Pin button in preview", () => {
    mockPinned = [];
    mockPathname = "/plugin/loyalty-stamps";
    mockPreviewMasterId = 5555;
    mockPreviewMasterWebUserId = "master-uid";
    renderWithLang(<PinnedNavSection />);
    // Transient row is rendered (the master can navigate to it), but
    // Pin button is omitted because owner doesn't write the master's
    // saved layout.
    expect(screen.getByTestId("open-plugin-nav-item")).toBeDefined();
    expect(screen.queryByTitle("Закрепить")).toBeNull();
  });

  it("regular owner view (no preview) still renders Pin button", () => {
    mockPinned = [];
    mockPathname = "/plugin/loyalty-stamps";
    mockPreviewMasterId = null;
    mockPreviewMasterWebUserId = null;
    renderWithLang(<PinnedNavSection />);
    expect(screen.getByTitle("Закрепить")).toBeDefined();
  });
});
