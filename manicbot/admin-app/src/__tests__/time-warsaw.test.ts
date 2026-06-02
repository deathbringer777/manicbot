import { describe, it, expect } from "vitest";
import { warsawToUtcMs, nowSec } from "~/lib/time";

/**
 * warsawToUtcMs is the admin-app port of the Worker's warsawToUTC(): it turns a
 * Warsaw wall-clock (month 1-indexed) into a UTC epoch in MILLISECONDS. These
 * pin the two halves of BUG-01: the UNIT (ms, not seconds) and the OFFSET
 * (Warsaw local time, not raw UTC). The round-trip assertion is DST-agnostic so
 * the test stays valid regardless of the tz database in effect.
 */
function partsInWarsaw(ms: number) {
  const p: Record<string, string> = {};
  for (const { type, value } of new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms))) {
    p[type] = value;
  }
  return p;
}

describe("warsawToUtcMs — Warsaw wall-clock → UTC epoch ms", () => {
  it("returns epoch MILLISECONDS, not seconds", () => {
    // ms scale ~1.7e12; the old seconds bug produced ~1.7e9.
    expect(warsawToUtcMs(2026, 7, 1, 15, 0)).toBeGreaterThan(1e12);
  });

  it("round-trips back to the requested Warsaw wall clock (summer + winter)", () => {
    const summer = partsInWarsaw(warsawToUtcMs(2026, 7, 1, 15, 0));
    expect(`${summer.year}-${summer.month}-${summer.day} ${summer.hour}:${summer.minute}`).toBe("2026-07-01 15:00");
    const winter = partsInWarsaw(warsawToUtcMs(2026, 1, 15, 10, 0));
    expect(`${winter.year}-${winter.month}-${winter.day} ${winter.hour}:${winter.minute}`).toBe("2026-01-15 10:00");
  });

  it("applies a real Warsaw offset (1h CET or 2h CEST), i.e. NOT raw UTC", () => {
    const rawUtc = Date.UTC(2026, 6, 1, 15, 0); // naive, buggy interpretation
    const diff = rawUtc - warsawToUtcMs(2026, 7, 1, 15, 0);
    expect([3600000, 7200000]).toContain(diff);
  });

  it("nowSec stays in seconds (unchanged)", () => {
    expect(nowSec()).toBeLessThan(1e11);
  });
});
