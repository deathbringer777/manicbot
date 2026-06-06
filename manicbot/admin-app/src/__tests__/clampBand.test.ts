import { describe, it, expect } from "vitest";
import { clampBand } from "~/lib/calendar/clampBand";

/**
 * clampBand pins a calendar block's pixel geometry to the visible hour window
 * [0, totalPx] so an over-long single-day block (e.g. a 24h "day off") can't
 * overflow the grid, extend the scroll area, and leave a void below working
 * hours. Regression for the prod incident: a time_off block with
 * duration_min=1440 starting 08:45 rendered ~1152px tall inside a 576px grid.
 */
describe("clampBand", () => {
  const TOTAL = 576; // 12 visible hours * 48px (HOUR_HEIGHT)

  it("leaves a band fully inside the window untouched", () => {
    expect(clampBand(96, 48, TOTAL)).toEqual({ top: 96, height: 48 });
  });

  it("clamps a 24h single-day block to the window (the bug)", () => {
    // 08:45 with a 9:00 window start → rawTop = -12; 1440min → rawHeight = 1152.
    expect(clampBand(-12, 1152, TOTAL)).toEqual({ top: 0, height: TOTAL });
  });

  it("clamps a band that starts before the window", () => {
    expect(clampBand(-30, 60, TOTAL)).toEqual({ top: 0, height: 30 });
  });

  it("clamps a band that ends after the window", () => {
    expect(clampBand(540, 200, TOTAL)).toEqual({ top: 540, height: 36 });
  });

  it("yields zero height for a band entirely after the window", () => {
    expect(clampBand(600, 48, TOTAL)).toEqual({ top: TOTAL, height: 0 });
  });

  it("yields zero height for a band entirely before the window", () => {
    expect(clampBand(-200, 100, TOTAL)).toEqual({ top: 0, height: 0 });
  });

  it("never returns negative top or height", () => {
    const r = clampBand(-9999, -50, TOTAL);
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.height).toBeGreaterThanOrEqual(0);
  });
});
