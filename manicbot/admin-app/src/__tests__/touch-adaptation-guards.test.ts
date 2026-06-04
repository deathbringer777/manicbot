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
