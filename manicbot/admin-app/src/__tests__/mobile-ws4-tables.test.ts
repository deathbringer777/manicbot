// @vitest-environment node
/**
 * WS-4 mobile guards — no grid forces >2 columns on a phone, and wide data
 * tables expose a scroll affordance. Pattern, not pixel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("WS-4 — stat grids collapse to 2 columns on phones", () => {
  it("Events stats grid is responsive (was bare grid-cols-4)", () => {
    const src = read("src/app/(dashboard)/events/EventsPageClient.tsx");
    expect(src).toContain("grid-cols-2 gap-2 sm:grid-cols-4");
    expect(src).not.toContain('"grid grid-cols-4 gap-2"');
  });

  it("ErrorStatsWidget grid is responsive (was bare grid-cols-4)", () => {
    const src = read("src/components/dashboard/ErrorStatsWidget.tsx");
    expect(src).toContain("grid-cols-2 gap-3 sm:grid-cols-4");
    expect(src).not.toContain('"grid grid-cols-4 gap-3"');
  });
});

describe("WS-4 — wide tables expose a scroll affordance", () => {
  it("ResponsiveTable supports a surface-matched fade color", () => {
    expect(read("src/components/ui/ResponsiveTable.tsx")).toContain("fadeFromClass");
  });

  it("Contacts table adopts ResponsiveTable for the mobile edge-fade", () => {
    const src = read("src/app/(dashboard)/marketing/contacts/ContactsClient.tsx");
    expect(src).toContain('import { ResponsiveTable }');
    expect(src).toContain("<ResponsiveTable");
  });
});
