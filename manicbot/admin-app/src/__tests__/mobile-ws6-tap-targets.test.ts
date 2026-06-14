// @vitest-environment node
/**
 * WS-6 mobile guards — raw icon-only nav controls meet the 44px touch target
 * via the opt-in `.tap-target` utility (only enforced on coarse pointers, so
 * desktop keeps its compact footprint). Pattern, not pixel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("WS-6 — .tap-target utility", () => {
  it("is defined inside the coarse-pointer block at 44px", () => {
    const css = read("src/styles/globals.css");
    expect(css).toContain(".tap-target");
    expect(css).toContain("min-height: 2.75rem");
    expect(css).toContain("min-width: 2.75rem");
  });
});

describe("WS-6 — nav icon controls adopt tap-target", () => {
  it("WebShell hamburger + drawer-close are 44px and labelled", () => {
    const src = read("src/components/layout/WebShell.tsx");
    expect(src).toContain("tap-target");
    expect(src).toContain('aria-label="Open menu"');
    expect(src).toContain('aria-label="Close menu"');
  });

  it("Sheet close button uses tap-target", () => {
    expect(read("src/components/ui/Sheet.tsx")).toContain("tap-target");
  });
});
