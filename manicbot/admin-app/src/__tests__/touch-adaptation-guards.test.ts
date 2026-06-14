// @vitest-environment node
/**
 * Source-level guards for the touch-adaptation pass (Phase 2). These pin the
 * CSS/markup patterns so a refactor can't silently drop them — pattern, not
 * pixel: they assert the rule exists, not how it renders.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("touch adaptation — globals.css", () => {
  const css = read("src/styles/globals.css");

  it("has a coarse-pointer (hover: none) block", () => {
    expect(css).toContain("@media (hover: none)");
  });

  it("reveals hover-gated action affordances on touch", () => {
    expect(css).toContain(".group-hover\\:opacity-100");
  });

  it("floors Button primitive tap targets via data-size", () => {
    expect(css).toContain('button[data-size="md"]');
  });

  it("adds press feedback on touch", () => {
    expect(css).toContain("button:active");
  });
});

describe("touch adaptation — overflow + viewport guards", () => {
  it("AnalyticsTab wraps the campaigns table in a horizontal scroller", () => {
    const src = read("src/components/salon/AnalyticsTab.tsx");
    expect(src).toContain("overflow-x-auto");
    expect(src).toContain("min-w-[32rem]");
  });

  it("right-aligned dropdowns cap their width to the viewport", () => {
    for (const f of [
      "src/components/layout/NotificationBell.tsx",
      "src/components/layout/TenantSwitcher.tsx",
      "src/components/salon/ServiceAddMenu.tsx",
    ]) {
      expect(read(f)).toContain("max-w-[calc(100vw-1.5rem)]");
    }
  });
});

describe("WS-0 foundation — globals.css base rules", () => {
  const css = read("src/styles/globals.css");

  it("kills iOS focus-zoom by flooring form controls at 16px on touch", () => {
    // The rule lives inside the @media (hover: none) block (asserted above).
    expect(css).toContain("font-size: 16px");
  });

  it("removes the grey tap-flash on interactive controls", () => {
    expect(css).toContain("-webkit-tap-highlight-color: transparent");
  });

  it("drops the 300ms tap delay via touch-action: manipulation", () => {
    expect(css).toContain("touch-action: manipulation");
  });

  it("contains overscroll so the page doesn't rubber-band behind modals", () => {
    expect(css).toContain("overscroll-behavior-y: contain");
  });
});

describe("WS-0 foundation — viewport + primitives", () => {
  it("layout opts into viewport-fit=cover for safe-area insets", () => {
    expect(read("src/app/layout.tsx")).toContain('viewportFit: "cover"');
  });

  it("ResponsiveTable provides a horizontal scroll wrapper", () => {
    const src = read("src/components/ui/ResponsiveTable.tsx");
    expect(src).toContain("overflow-x-auto");
    expect(src).toContain("overscroll-x-contain");
  });

  it("Sheet is a mobile-bottom-sheet / desktop-centered overlay", () => {
    const src = read("src/components/ui/Sheet.tsx");
    expect(src).toContain("items-end");
    expect(src).toContain("sm:items-center");
  });

  it("Sheet locks body scroll, traps focus, and pads the safe area", () => {
    const src = read("src/components/ui/Sheet.tsx");
    expect(src).toContain('document.body.style.overflow = "hidden"');
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain('e.key !== "Tab"');
    expect(src).toContain("env(safe-area-inset-bottom)");
  });
});
