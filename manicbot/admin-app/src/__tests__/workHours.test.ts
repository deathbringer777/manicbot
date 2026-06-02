/**
 * workHours helpers — round-trip + legacy compatibility for the per-day
 * salon schedule used by PublicProfileEditor and SalonProfileClient.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_WORK_HOURS,
  WEEKDAY_KEYS,
  hydrateWorkHours,
  serializeWorkHours,
  decodePerDayWorkHours,
  isValidMasterHours,
  serializeMasterHours,
  parseMasterHours,
  serializeMasterWorkDays,
  parseMasterWorkDays,
} from "~/lib/workHours";

describe("workHours helpers", () => {
  it("round-trips the per-day shape", () => {
    const state = {
      mon: { open: "09:30", close: "19:00" },
      tue: { open: "09:00", close: "18:00" },
      wed: { open: "09:00", close: "18:00" },
      thu: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "18:00" },
      sat: { open: "10:00", close: "16:00" },
      sun: null,
    };
    const serialized = serializeWorkHours(state);
    expect(serialized).toMatch(/^\{"days":\{/);
    expect(hydrateWorkHours(serialized)).toEqual(state);
  });

  it("hydrates the legacy plain-string format as same-hours-every-day, Sun off", () => {
    const state = hydrateWorkHours("09:00 – 18:00");
    expect(state.mon).toEqual({ open: "09:00", close: "18:00" });
    expect(state.sat).toEqual({ open: "09:00", close: "18:00" });
    expect(state.sun).toBeNull();
  });

  it("hydrates the legacy { from, to } numeric shape", () => {
    const state = hydrateWorkHours({ from: 9, to: 18 });
    expect(state.mon).toEqual({ open: "09:00", close: "18:00" });
    expect(state.sun).toBeNull();
  });

  it("falls back to defaults for unknown / empty input", () => {
    expect(hydrateWorkHours(null)).toEqual(DEFAULT_WORK_HOURS);
    expect(hydrateWorkHours(undefined)).toEqual(DEFAULT_WORK_HOURS);
    expect(hydrateWorkHours("")).toEqual(DEFAULT_WORK_HOURS);
    expect(hydrateWorkHours({})).toEqual(DEFAULT_WORK_HOURS);
  });

  it("serialized payload fits under the 500-char server cap", () => {
    // Worst-case payload: every weekday filled with the wide HH:MM shape.
    const state = Object.fromEntries(
      WEEKDAY_KEYS.map((d) => [d, { open: "23:59", close: "23:59" }]),
    ) as Record<(typeof WEEKDAY_KEYS)[number], { open: string; close: string }>;
    expect(serializeWorkHours(state).length).toBeLessThan(500);
  });

  it("decodePerDayWorkHours returns null for non-per-day shapes", () => {
    expect(decodePerDayWorkHours("09:00 – 18:00")).toBeNull();
    expect(decodePerDayWorkHours(null)).toBeNull();
    expect(decodePerDayWorkHours({ from: 9, to: 18 })).toBeNull();
    expect(decodePerDayWorkHours("not json")).toBeNull();
  });

  it("decodePerDayWorkHours returns 7-day array in Mon..Sun order", () => {
    const serialized = serializeWorkHours({
      mon: { open: "09:00", close: "18:00" },
      tue: { open: "09:00", close: "18:00" },
      wed: { open: "09:00", close: "18:00" },
      thu: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "18:00" },
      sat: null,
      sun: null,
    });
    const arr = decodePerDayWorkHours(serialized);
    expect(arr).toHaveLength(7);
    expect(arr?.[0]).toEqual({ open: "09:00", close: "18:00" });
    expect(arr?.[5]).toBeNull();
    expect(arr?.[6]).toBeNull();
  });
});

/**
 * Per-master booking schedule — a DIFFERENT shape from the salon-wide per-day
 * hours above. The Worker booking engine (src/services/appointments.js,
 * getSlots) reads `masters.work_hours` as a single `{ from, to }` integer
 * window and `masters.work_days` as a list of UTC weekdays (0=Sun … 6=Sat,
 * matching Date.getUTCDay). These helpers produce/parse exactly that shape so
 * the owner-side and master-side editors stay in lockstep with what booking
 * actually enforces. Locked-in contract: test/master-selection.test.js.
 */
describe("master schedule helpers ({from,to} + workDays — booking-engine shape)", () => {
  it("isValidMasterHours accepts an in-order integer window", () => {
    expect(isValidMasterHours(10, 18)).toBe(true);
    expect(isValidMasterHours(0, 24)).toBe(true);
  });

  it("isValidMasterHours rejects inverted, equal, out-of-range or fractional windows", () => {
    expect(isValidMasterHours(18, 10)).toBe(false);
    expect(isValidMasterHours(12, 12)).toBe(false);
    expect(isValidMasterHours(-1, 18)).toBe(false);
    expect(isValidMasterHours(9, 25)).toBe(false);
    expect(isValidMasterHours(9.5, 18)).toBe(false);
  });

  it("serializeMasterHours emits the {from,to} shape the Worker reads", () => {
    expect(serializeMasterHours(10, 18)).toBe('{"from":10,"to":18}');
  });

  it("serializeMasterHours throws on an invalid window", () => {
    expect(() => serializeMasterHours(18, 10)).toThrow();
  });

  it("parseMasterHours round-trips a string and reads a raw object", () => {
    expect(parseMasterHours('{"from":10,"to":18}')).toEqual({ from: 10, to: 18 });
    expect(parseMasterHours({ from: 9, to: 20 })).toEqual({ from: 9, to: 20 });
  });

  it("parseMasterHours returns null for the salon per-day shape or junk", () => {
    expect(parseMasterHours(serializeWorkHours(DEFAULT_WORK_HOURS))).toBeNull();
    expect(parseMasterHours("not json")).toBeNull();
    expect(parseMasterHours("")).toBeNull();
    expect(parseMasterHours(null)).toBeNull();
  });

  it("serializeMasterWorkDays sorts, de-dupes and clamps to 0..6", () => {
    expect(serializeMasterWorkDays([1, 2, 3, 4, 5, 6])).toBe("[1,2,3,4,5,6]");
    expect(serializeMasterWorkDays([3, 1, 1, 2])).toBe("[1,2,3]");
    expect(serializeMasterWorkDays([0, 6, 7, -1, 3])).toBe("[0,3,6]");
  });

  it("parseMasterWorkDays reads an array or json string and drops out-of-range entries", () => {
    expect(parseMasterWorkDays("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseMasterWorkDays([0, 6])).toEqual([0, 6]);
    expect(parseMasterWorkDays("[1,9,2]")).toEqual([1, 2]);
    expect(parseMasterWorkDays("not json")).toBeNull();
    expect(parseMasterWorkDays("{}")).toBeNull();
  });
});
