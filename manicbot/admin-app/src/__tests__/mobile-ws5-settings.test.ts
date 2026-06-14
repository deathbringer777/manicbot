// @vitest-environment node
/**
 * WS-5 mobile guard — the settings tab strip must signal that it scrolls on
 * phones (the round scroll buttons are desktop-only). Pattern, not pixel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("WS-5 — settings tab strip scroll affordance on mobile", () => {
  const src = read("src/components/settings/SettingsShell.tsx");

  it("shows the edge fades on every viewport (not gated to lg)", () => {
    // The fade divs are now `block absolute`, not `hidden lg:block`.
    expect(src).toContain("pointer-events-none block absolute left-0");
    expect(src).toContain("pointer-events-none block absolute right-0");
  });

  it("keeps the round scroll buttons desktop-only", () => {
    expect(src).toContain("hidden lg:flex absolute left-0");
    expect(src).toContain("hidden lg:flex absolute right-0");
  });
});
