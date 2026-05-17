// @vitest-environment happy-dom
/**
 * PinnedNavSection — verifies pinned plugin rows AND the new "transient open
 * plugin" row that mirrors the currently-open /plugin/<slug> runtime.
 *
 * Browser-tab metaphor:
 *  - Open  = transient, only while the user is on /plugin/<slug>, with a Pin button.
 *  - Pinned = persistent, written to D1 via plugins.togglePin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { renderWithLang } from "./helpers/renderWithLang";

// ─── stateful mocks ─────────────────────────────────────────────────────────
let mockPinned: string[] = [];
let mockPathname: string = "/dashboard";
const mockMutate = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// Pin button visibility depends on `canWrite` derived from RoleContext.
// Default-mocked owner profile lets the existing assertions about the
// always-visible Pin button continue to pass.
let mockPreviewMasterId: number | null = null;
let mockPreviewMasterWebUserId: string | null = null;
vi.mock("~/components/RoleContext", () => ({
  useRole: () => ({
    tenantId: "tenant_default",
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
        useMutation: () => ({
          mutate: (input: { slug: string }) => {
            mockMutate(input);
          },
          error: null,
        }),
      },
    },
  },
}));

import { PinnedNavSection } from "~/components/layout/PinnedNavSection";

beforeEach(() => {
  mockPinned = [];
  mockPathname = "/dashboard";
  mockMutate.mockClear();
  mockPreviewMasterId = null;
  mockPreviewMasterWebUserId = null;
  try {
    window.localStorage.removeItem("manicbot_pinned_plugins");
  } catch {
    /* noop */
  }
});

afterEach(() => cleanup());

// ─── transient open-plugin row ──────────────────────────────────────────────

describe("PinnedNavSection — transient open plugin row", () => {
  it("renders open plugin as transient item when on /plugin/<slug> and not pinned", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const row = screen.getByTestId("open-plugin-nav-item");
    expect(row).not.toBeNull();
    expect(row.getAttribute("href")).toBe("/plugin/loyalty-stamps");
    // Pin button (always-visible) is queryable by its localized title.
    expect(screen.getByTitle("Закрепить")).not.toBeNull();
  });

  it("does NOT render transient item when slug is already pinned (no duplicate)", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
    // Exactly one row references loyalty-stamps (the pinned one).
    const all = screen.getAllByRole("link").filter((el) => el.getAttribute("href") === "/plugin/loyalty-stamps");
    expect(all.length).toBe(1);
  });

  it("does NOT render transient item when pathname is not /plugin/<slug>", () => {
    mockPinned = [];
    for (const path of ["/dashboard", "/plugins", "/plugins/loyalty-stamps", "/settings"]) {
      mockPathname = path;
      cleanup();
      renderWithLang(<PinnedNavSection />);
      expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
    }
  });

  it("does NOT render transient item when plugin has no runtime", () => {
    // portfolio-gallery is registered but has no runtime panel.
    mockPathname = "/plugin/portfolio-gallery";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
  });

  it("does NOT render transient item when slug is unknown to the registry", () => {
    mockPathname = "/plugin/typo-does-not-exist";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
  });

  it("clicking Pin on transient item calls togglePin mutation with the slug", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    fireEvent.click(screen.getByTitle("Закрепить"));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith({ slug: "loyalty-stamps" });
  });

  it("after Pin click + state propagation, transient row gives way to a pinned row", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).not.toBeNull();

    fireEvent.click(screen.getByTitle("Закрепить"));
    expect(mockMutate).toHaveBeenCalledWith({ slug: "loyalty-stamps" });

    // Simulate optimistic update: server-side state now contains the slug.
    // Re-render to pick up the new mockPinned value.
    cleanup();
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
    const pinned = screen.getByTestId("pinned-nav-item");
    expect(pinned.getAttribute("data-slug")).toBe("loyalty-stamps");
  });

  it("transient row shows the accent active highlight", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const link = screen.getByTestId("open-plugin-nav-item");
    const cls = link.className;
    expect(cls).toContain("bg-accent-500/10");
    expect(cls).toContain("border-accent-500");
  });

  it("transient row label uses the italic class (locks the visual choice)", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const link = screen.getByTestId("open-plugin-nav-item");
    // The label <span> sits inside the link; italic class applied to it.
    const labelSpan = link.querySelector("span.italic");
    expect(labelSpan).not.toBeNull();
  });

  it("href ignores query string and hash on /plugin/<slug>", () => {
    mockPathname = "/plugin/loyalty-stamps?ref=x#top";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const row = screen.getByTestId("open-plugin-nav-item");
    expect(row.getAttribute("href")).toBe("/plugin/loyalty-stamps");
  });

  it("collapsed mode hides the Pin button on transient row (icon only)", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection collapsed />);
    // Row still rendered, but Pin button (always-visible in expanded mode) is suppressed.
    expect(screen.getByTestId("open-plugin-nav-item")).not.toBeNull();
    expect(screen.queryByTitle("Закрепить")).toBeNull();
  });
});

// ─── header behavior ────────────────────────────────────────────────────────

describe("PinnedNavSection — header behavior", () => {
  it("section header is hidden when only transient item is present", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByText("Закреплённое")).toBeNull();
  });

  it("section header renders when at least one pinned item exists", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByText("Закреплённое")).not.toBeNull();
  });
});

// ─── pinned-row active highlight (regression for the new active flag) ──────

describe("PinnedNavSection — active highlight on pinned row", () => {
  it("pinned row receives accent active highlight when pathname matches its href", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    const row = screen.getByTestId("pinned-nav-item");
    const cls = row.className;
    expect(cls).toContain("bg-accent-500/10");
    expect(cls).toContain("border-accent-500");
  });

  it("pinned row does NOT get active highlight when pathname differs", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    const row = screen.getByTestId("pinned-nav-item");
    expect(row.className).not.toContain("bg-accent-500/10");
  });
});

// ─── i18n: Pin button title localizes correctly ─────────────────────────────

describe("PinnedNavSection — Pin button localization", () => {
  const cases: Array<{ lang: "ru" | "ua" | "en" | "pl"; expected: string }> = [
    { lang: "ru", expected: "Закрепить" },
    { lang: "ua", expected: "Закріпити" },
    { lang: "en", expected: "Pin" },
    { lang: "pl", expected: "Przypnij" },
  ];
  for (const { lang, expected } of cases) {
    it(`renders Pin button title in ${lang}`, () => {
      mockPathname = "/plugin/loyalty-stamps";
      mockPinned = [];
      renderWithLang(<PinnedNavSection />, lang);
      expect(screen.getByTitle(expected)).not.toBeNull();
    });
  }

  it("pinned row Unpin button localizes to ua", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />, "ua");
    expect(screen.getByTitle("Відкріпити")).not.toBeNull();
  });
});

// ─── regex edge cases ───────────────────────────────────────────────────────

describe("PinnedNavSection — pathname regex edge cases", () => {
  it("captures only the first segment for /plugin/<slug>/sub/path", () => {
    mockPathname = "/plugin/loyalty-stamps/sub/page";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const row = screen.getByTestId("open-plugin-nav-item");
    expect(row.getAttribute("href")).toBe("/plugin/loyalty-stamps");
  });

  it("returns no transient for /plugin (no slug)", () => {
    mockPathname = "/plugin";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
  });

  it("returns no transient for /plugin/ (trailing slash, empty slug)", () => {
    mockPathname = "/plugin/";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
  });

  it("returns no transient for catalog detail /plugins/<slug> (plural)", () => {
    mockPathname = "/plugins/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).toBeNull();
  });
});

// ─── empty-state precedence ─────────────────────────────────────────────────

describe("PinnedNavSection — empty-state precedence", () => {
  it("renders empty-state CTA when no pinned, no transient, and showEmpty=true", () => {
    mockPathname = "/dashboard";
    mockPinned = [];
    renderWithLang(<PinnedNavSection showEmpty />);
    expect(screen.queryByTestId("pinned-nav-empty")).not.toBeNull();
    expect(screen.queryByTestId("pinned-nav-section")).toBeNull();
  });

  it("hides empty-state when transient is present, even with showEmpty=true", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection showEmpty />);
    expect(screen.queryByTestId("pinned-nav-empty")).toBeNull();
    expect(screen.queryByTestId("open-plugin-nav-item")).not.toBeNull();
  });

  it("hides empty-state when pinned items exist, even with showEmpty=true", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection showEmpty />);
    expect(screen.queryByTestId("pinned-nav-empty")).toBeNull();
    expect(screen.queryByTestId("pinned-nav-section")).not.toBeNull();
  });
});

// ─── button cross-contamination ─────────────────────────────────────────────

describe("PinnedNavSection — Pin/Unpin button isolation", () => {
  it("transient row renders Pin but NOT Unpin", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTitle("Закрепить")).not.toBeNull();
    expect(screen.queryByTitle("Открепить")).toBeNull();
  });

  it("pinned row renders Unpin but NOT always-visible Pin", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTitle("Открепить")).not.toBeNull();
    expect(screen.queryByTitle("Закрепить")).toBeNull();
  });

  it("transient + pinned together: both buttons coexist on different slugs", () => {
    mockPathname = "/plugin/task-board";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    expect(screen.queryByTestId("open-plugin-nav-item")).not.toBeNull();
    expect(screen.queryByTestId("pinned-nav-item")).not.toBeNull();
    expect(screen.queryByTitle("Закрепить")).not.toBeNull();
    expect(screen.queryByTitle("Открепить")).not.toBeNull();
  });
});

// ─── button visibility classes ──────────────────────────────────────────────

describe("PinnedNavSection — button visibility classes", () => {
  it("Pin button on transient row is always visible (no opacity-0 class)", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const btn = screen.getByTitle("Закрепить");
    expect(btn.className).not.toContain("opacity-0");
  });

  it("Unpin button on pinned row is hover-only (opacity-0 group-hover:opacity-100)", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    const btn = screen.getByTitle("Открепить");
    expect(btn.className).toContain("opacity-0");
    expect(btn.className).toContain("group-hover:opacity-100");
  });
});

// ─── multiple pinned items: order preservation ──────────────────────────────

describe("PinnedNavSection — multiple pinned items", () => {
  it("renders pinned items in the order returned by listPinned", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps", "task-board", "task-board"];
    renderWithLang(<PinnedNavSection />);
    const rows = screen.getAllByTestId("pinned-nav-item");
    expect(rows.length).toBe(3);
    expect(rows[0]!.getAttribute("data-slug")).toBe("loyalty-stamps");
    expect(rows[1]!.getAttribute("data-slug")).toBe("task-board");
    expect(rows[2]!.getAttribute("data-slug")).toBe("task-board");
  });

  it("skips pinned slugs that are unknown to the registry (no crash)", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps", "fake-slug-xyz", "task-board"];
    renderWithLang(<PinnedNavSection />);
    const rows = screen.getAllByTestId("pinned-nav-item");
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.getAttribute("data-slug"))).toEqual([
      "loyalty-stamps",
      "task-board",
    ]);
  });
});

// ─── icon tint propagation ──────────────────────────────────────────────────

describe("PinnedNavSection — icon tint", () => {
  it("transient row icon receives manifest tint as inline color style", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    // loyalty-stamps manifest declares icon tint "#eab308" (yellow/gold).
    const link = screen.getByTestId("open-plugin-nav-item");
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("style")).toMatch(/color:\s*(#eab308|rgb\(234,\s*179,\s*8\))/i);
  });

  it("pinned row icon receives manifest tint as inline color style", () => {
    mockPathname = "/dashboard";
    mockPinned = ["loyalty-stamps"];
    renderWithLang(<PinnedNavSection />);
    const link = screen.getByTestId("pinned-nav-item");
    const icon = link.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("style")).toMatch(/color:\s*(#eab308|rgb\(234,\s*179,\s*8\))/i);
  });
});

// ─── transient row composition: italic + active stack ───────────────────────

describe("PinnedNavSection — transient row composition", () => {
  it("transient row label keeps italic class even while active", () => {
    mockPathname = "/plugin/loyalty-stamps";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const link = screen.getByTestId("open-plugin-nav-item");
    // Italic survives alongside the active accent classes.
    expect(link.className).toContain("bg-accent-500/10");
    expect(link.querySelector("span.italic")).not.toBeNull();
  });

  it("transient row carries data-slug matching the URL slug", () => {
    mockPathname = "/plugin/task-board?ref=x";
    mockPinned = [];
    renderWithLang(<PinnedNavSection />);
    const link = screen.getByTestId("open-plugin-nav-item");
    expect(link.getAttribute("data-slug")).toBe("task-board");
  });
});
