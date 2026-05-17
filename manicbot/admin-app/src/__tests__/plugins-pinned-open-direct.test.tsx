// @vitest-environment happy-dom
/**
 * Verifies that PinnedNavSection renders href="/plugin/<slug>" (singular)
 * so pinned-plugin clicks open the runtime page, not the catalog detail page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

// Mock tRPC
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      plugins: {
        listPinned: {
          cancel: () => Promise.resolve(),
          getData: () => ["task-board"],
          setData: () => {},
          invalidate: () => Promise.resolve(),
        },
      },
    }),
    plugins: {
      listPinned: {
        useQuery: () => ({ data: ["task-board"], isLoading: false }),
      },
      togglePin: {
        useMutation: () => ({ mutate: () => {}, error: null }),
      },
    },
  },
}));

import { PinnedNavSection } from "~/components/layout/PinnedNavSection";

beforeEach(() => {
  // Note: happy-dom doesn't implement localStorage.clear() — use setItem to clear specific keys
  try { window.localStorage.removeItem("manicbot_pinned_plugins"); } catch { /* noop */ }
});

afterEach(() => cleanup());

describe("PinnedNavSection — href uses singular /plugin/<slug>", () => {
  it("renders a link with href=/plugin/<slug> for a pinned plugin", () => {
    renderWithLang(<PinnedNavSection />);
    const links = screen.getAllByTestId("pinned-nav-item");
    expect(links.length).toBeGreaterThan(0);
    const href = links[0]!.getAttribute("href");
    expect(href).toBe("/plugin/task-board");
    expect(href).not.toContain("/plugins/");
  });

  it("the link does NOT point to the catalog detail URL /plugins/<slug>", () => {
    renderWithLang(<PinnedNavSection />);
    const links = screen.getAllByTestId("pinned-nav-item");
    for (const link of links) {
      expect(link.getAttribute("href")).not.toMatch(/^\/plugins\//);
    }
  });
});
