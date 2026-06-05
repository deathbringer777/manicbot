/**
 * salonMetrics — pure time-range helper boundary tests (TDD, written first).
 *
 * These helpers are the correctness core the procedures lean on. Because the
 * admin-app test harness uses a queue-based Drizzle mock (no real SQL engine),
 * the *numeric* correctness of the windows is pinned HERE, deterministically,
 * with an injected `nowMs` — never `Date.now()` inside the helper.
 *
 * Unit contract (verified against the Worker writers + schema comments):
 *   - `appointments.ts`        → epoch MILLISECONDS  (Date.now())
 *   - `appointments.createdAt` → epoch SECONDS       (nowSec())
 *   - `users.registeredAt`     → epoch SECONDS        (nowSec())
 * So appointment WINDOW filters use ms; "new clients" uses seconds.
 */
import { describe, it, expect } from "vitest";
import {
  periodToRange,
  dailyRange,
  fillDailyGaps,
  startOfCurrentMonthMs,
  startOfCurrentWeekMs,
  PERIOD_DAYS,
} from "~/server/api/routers/salonMetrics";

// A fixed reference instant: 2026-06-06T12:34:56.000Z (a Saturday, UTC).
const NOW_ISO = "2026-06-06T12:34:56.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const DAY_MS = 86_400_000;

describe("PERIOD_DAYS", () => {
  it("maps each period to its day count", () => {
    expect(PERIOD_DAYS).toEqual({ "7d": 7, "30d": 30, "90d": 90 });
  });
});

describe("periodToRange", () => {
  it("7d window is exactly 7 days wide, ending at now", () => {
    const r = periodToRange("7d", NOW_MS);
    expect(r.toMs).toBe(NOW_MS);
    expect(r.fromMs).toBe(NOW_MS - 7 * DAY_MS);
    // seconds mirrors for the seconds-unit columns
    expect(r.fromSec).toBe(Math.floor((NOW_MS - 7 * DAY_MS) / 1000));
    expect(r.toSec).toBe(Math.floor(NOW_MS / 1000));
  });

  it("30d and 90d widen the window accordingly", () => {
    expect(periodToRange("30d", NOW_MS).fromMs).toBe(NOW_MS - 30 * DAY_MS);
    expect(periodToRange("90d", NOW_MS).fromMs).toBe(NOW_MS - 90 * DAY_MS);
  });

  it("exposes ISO YYYY-MM-DD bounds for the text `date` column", () => {
    const r = periodToRange("7d", NOW_MS);
    expect(r.toISO).toBe("2026-06-06");
    expect(r.fromISO).toBe("2026-05-30"); // 7 days before the 6th
  });

  it("is a pure function of its `nowMs` arg (no wall-clock dependence)", () => {
    const a = periodToRange("30d", NOW_MS);
    const b = periodToRange("30d", NOW_MS);
    expect(a).toEqual(b);
  });
});

describe("startOfCurrentMonthMs", () => {
  it("returns 00:00:00.000 UTC on the 1st of the current month", () => {
    const ms = startOfCurrentMonthMs(NOW_MS);
    expect(new Date(ms).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("a timestamp on the 1st at midnight is included (boundary is inclusive)", () => {
    const firstMidnight = Date.parse("2026-06-01T00:00:00.000Z");
    expect(startOfCurrentMonthMs(firstMidnight)).toBe(firstMidnight);
  });

  it("handles January (year boundary) without leaking into the prior year", () => {
    const jan = Date.parse("2026-01-15T09:00:00.000Z");
    expect(new Date(startOfCurrentMonthMs(jan)).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("startOfCurrentWeekMs", () => {
  it("returns Monday 00:00:00.000 UTC of the current ISO week", () => {
    // 2026-06-06 is a Saturday → Monday of that week is 2026-06-01.
    const ms = startOfCurrentWeekMs(NOW_MS);
    expect(new Date(ms).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("treats Sunday as the LAST day of the week (ISO), not the first", () => {
    // 2026-06-07 is a Sunday → still belongs to the week starting Mon 2026-06-01.
    const sunday = Date.parse("2026-06-07T23:00:00.000Z");
    expect(new Date(startOfCurrentWeekMs(sunday)).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("Monday maps to itself at midnight", () => {
    const monday = Date.parse("2026-06-08T15:00:00.000Z"); // a Monday
    expect(new Date(startOfCurrentWeekMs(monday)).toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });
});

describe("dailyRange", () => {
  it("returns `days` consecutive ISO dates ending today, inclusive", () => {
    const r = dailyRange(3, NOW_MS);
    expect(r.dates).toEqual(["2026-06-04", "2026-06-05", "2026-06-06"]);
    // fromMs is the start of the earliest day (00:00 UTC) for the ts filter
    expect(new Date(r.fromMs).toISOString()).toBe("2026-06-04T00:00:00.000Z");
  });

  it("a 1-day range is just today", () => {
    expect(dailyRange(1, NOW_MS).dates).toEqual(["2026-06-06"]);
  });

  it("crosses month boundaries correctly", () => {
    const r = dailyRange(3, Date.parse("2026-03-01T10:00:00.000Z"));
    expect(r.dates).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
  });
});

describe("fillDailyGaps", () => {
  it("fills missing dates with 0 and preserves present counts, in order", () => {
    const dates = ["2026-06-04", "2026-06-05", "2026-06-06"];
    const present = new Map<string, number>([
      ["2026-06-04", 3],
      ["2026-06-06", 5],
    ]);
    expect(fillDailyGaps(dates, present)).toEqual([
      { date: "2026-06-04", appointments: 3 },
      { date: "2026-06-05", appointments: 0 },
      { date: "2026-06-06", appointments: 5 },
    ]);
  });

  it("returns all-zero rows when there is no data", () => {
    const dates = ["2026-06-05", "2026-06-06"];
    expect(fillDailyGaps(dates, new Map())).toEqual([
      { date: "2026-06-05", appointments: 0 },
      { date: "2026-06-06", appointments: 0 },
    ]);
  });

  it("ignores stray dates not in the requested range", () => {
    const dates = ["2026-06-06"];
    const present = new Map<string, number>([
      ["2026-06-06", 2],
      ["2099-01-01", 999], // out of range — must be dropped
    ]);
    expect(fillDailyGaps(dates, present)).toEqual([{ date: "2026-06-06", appointments: 2 }]);
  });
});
