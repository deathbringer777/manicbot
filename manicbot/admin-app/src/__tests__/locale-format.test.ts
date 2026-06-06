/**
 * Locale-aware absolute date/time formatting (2026-06-06 audit).
 *
 * Bare `Date.toLocaleDateString()` / `toLocaleTimeString()` default to en-US,
 * which leaked "6/4/2026" and "12:46 AM" into the Russian UI. formatDate /
 * formatTime pin the locale and force 24h for ru/ua/pl.
 *
 * Relies on Node's full-ICU (ships by default ≥ v13).
 */
import { describe, it, expect } from "vitest";
import { formatDate, formatTime } from "~/lib/i18n";

// 2026-06-04 00:46 UTC — the exact shapes the audit caught.
const D = new Date(Date.UTC(2026, 5, 4, 0, 46));
const TZ = { timeZone: "UTC" } as const;

describe("formatDate", () => {
  it("renders dd.mm.yyyy for ru/ua/pl", () => {
    expect(formatDate(D, "ru", TZ)).toBe("04.06.2026");
    expect(formatDate(D, "ua", TZ)).toBe("04.06.2026");
    // pl-PL uses dotted d.mm.yyyy (no leading zero on the day)
    expect(formatDate(D, "pl", TZ)).toBe("4.06.2026");
  });
  it("keeps en-US m/d/yyyy", () => {
    expect(formatDate(D, "en", TZ)).toBe("6/4/2026");
  });
});

describe("formatTime", () => {
  it("renders 24-hour HH:MM for ru/ua/pl (no AM/PM)", () => {
    for (const lang of ["ru", "ua", "pl"] as const) {
      const out = formatTime(D, lang, TZ);
      expect(out).toBe("00:46");
      expect(out).not.toMatch(/AM|PM/i);
    }
  });
  it("keeps 12-hour clock for en", () => {
    expect(formatTime(D, "en", TZ)).toMatch(/12:46\s?AM/i);
  });
});
