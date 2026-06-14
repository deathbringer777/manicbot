// @vitest-environment node
/**
 * WS-3 mobile guards — date picker becomes a real bottom-sheet on phones, and
 * the calendar lands on single-day (not the 7-col horizontal-scroll week) on
 * coarse-pointer small screens. Pattern, not pixel: assert the rule exists.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("WS-3 — DatePicker mobile bottom-sheet", () => {
  const src = read("src/components/ui/DatePicker.tsx");

  it("renders the mobile calendar as a full-width bottom sheet", () => {
    expect(src).toContain("items-end"); // sheet anchored to the bottom
    expect(src).toContain("rounded-t-2xl"); // only the top corners are rounded
    expect(src).toContain("datepicker-slide-up"); // slide-up entrance
  });

  it("pads the sheet for the iOS home indicator", () => {
    expect(src).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
  });

  it("keeps the desktop popover anchored to the trigger (no regression)", () => {
    expect(src).toContain("absolute left-0 top-full");
  });
});

describe("WS-3 — calendar lands on single-day on phones", () => {
  it("exposes a once-on-mount coarse-pointer demotion hook", () => {
    const src = read("src/components/dashboards/CalendarViewSwitcher.tsx");
    expect(src).toContain("export function useMobileInitialDayView");
    expect(src).toContain('"(hover: none) and (max-width: 768px)"');
  });

  it("wires the hook into both appointment surfaces", () => {
    for (const f of [
      "src/app/(dashboard)/appointments/AppointmentsPageClient.tsx",
      "src/components/dashboards/SalonDashboard.tsx",
    ]) {
      expect(read(f)).toContain("useMobileInitialDayView(setAptViewMode)");
    }
  });
});
