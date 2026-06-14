// @vitest-environment node
/**
 * WS-2 mobile guards — long form modals keep their primary action reachable on
 * phones via a sticky, safe-area-padded action bar (so it can't hide under the
 * on-screen keyboard). Pattern, not pixel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("WS-2 — sticky action bar on form modals", () => {
  it("ManualBookingModal pins its action row above the keyboard on mobile", () => {
    const src = read("src/components/dashboard/ManualBookingModal.tsx");
    expect(src).toContain("sticky bottom-0");
    expect(src).toContain("env(safe-area-inset-bottom)");
    expect(src).toContain("sm:static"); // reverts to the inline row on desktop
  });

  it("ClientFormModal keeps its sticky footer (no regression)", () => {
    const src = read("src/components/salon/tabs/clients/ClientFormModal.tsx");
    expect(src).toContain("sticky bottom-0");
  });
});
