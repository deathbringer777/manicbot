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
  DEFAULT_MASTER_SCHEDULE,
  WEEKDAY_KEY_TO_DOW,
  DOW_TO_WEEKDAY_KEY,
  hydrateMasterSchedule,
  serializeMasterSchedule,
  decodeMasterSchedule,
  deriveWorkDaysFromSchedule,
  validateMasterSchedule,
  type MasterScheduleState,
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

/**
 * Per-day master schedule — per-weekday hours + one optional break. Stored in
 * the SAME `masters.work_hours` column as {"days":{...}}, with `work_days` kept
 * in sync as the derived 0..6 array. Resolved at booking time by the JS twin
 * src/services/masterSchedule.js (pinned by test/master-selection.test.js).
 */
describe("master per-day schedule (per-day hours + optional break)", () => {
  it("maps weekday keys to UTC dow with Sunday = 0", () => {
    expect(WEEKDAY_KEY_TO_DOW.mon).toBe(1);
    expect(WEEKDAY_KEY_TO_DOW.sat).toBe(6);
    expect(WEEKDAY_KEY_TO_DOW.sun).toBe(0);
    expect(DOW_TO_WEEKDAY_KEY[0]).toBe("sun");
    expect(DOW_TO_WEEKDAY_KEY[1]).toBe("mon");
    expect(DOW_TO_WEEKDAY_KEY[6]).toBe("sat");
  });

  it("round-trips serialize → decode with a break", () => {
    const state: MasterScheduleState = {
      mon: { open: "09:00", close: "18:00", break: { start: "13:00", end: "14:00" } },
      tue: { open: "10:00", close: "16:00" },
      wed: null, thu: null, fri: null, sat: null, sun: null,
    };
    const s = serializeMasterSchedule(state);
    expect(s).toMatch(/^\{"days":\{/);
    expect(decodeMasterSchedule(s)).toEqual(state);
  });

  it("serializeMasterSchedule omits the break key when a day has no break", () => {
    const s = serializeMasterSchedule({
      mon: { open: "09:00", close: "18:00" },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    });
    expect(s).not.toContain("break");
  });

  it("decodeMasterSchedule returns null for legacy / junk shapes", () => {
    expect(decodeMasterSchedule('{"from":9,"to":18}')).toBeNull();
    expect(decodeMasterSchedule("09:00 – 18:00")).toBeNull();
    expect(decodeMasterSchedule(null)).toBeNull();
    expect(decodeMasterSchedule("")).toBeNull();
    expect(decodeMasterSchedule("not json")).toBeNull();
  });

  it("hydrates the legacy {from,to} + workDays into per-day rows", () => {
    const st = hydrateMasterSchedule('{"from":14,"to":16}', "[1,3]");
    expect(st.mon).toEqual({ open: "14:00", close: "16:00" });
    expect(st.wed).toEqual({ open: "14:00", close: "16:00" });
    expect(st.tue).toBeNull();
    expect(st.sun).toBeNull();
  });

  it("hydrates empty input to the Mon–Sat default (Sun off)", () => {
    expect(hydrateMasterSchedule(null, null)).toEqual(DEFAULT_MASTER_SCHEDULE);
    expect(DEFAULT_MASTER_SCHEDULE.mon).toEqual({ open: "09:00", close: "18:00" });
    expect(DEFAULT_MASTER_SCHEDULE.sun).toBeNull();
  });

  it("passes the canonical {days} shape through hydrate unchanged", () => {
    const state: MasterScheduleState = {
      mon: { open: "08:00", close: "12:00", break: { start: "10:00", end: "10:30" } },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    };
    expect(hydrateMasterSchedule(serializeMasterSchedule(state))).toEqual(state);
  });

  it("derives sorted 0..6 work_days from enabled days (Sunday = 0)", () => {
    const state: MasterScheduleState = {
      mon: { open: "09:00", close: "18:00" }, tue: null,
      wed: { open: "09:00", close: "18:00" }, thu: null, fri: null, sat: null,
      sun: { open: "10:00", close: "14:00" },
    };
    expect(deriveWorkDaysFromSchedule(state)).toEqual([0, 1, 3]);
  });

  it("validates a correct schedule (break inside hours, touching edge allowed)", () => {
    expect(validateMasterSchedule({
      mon: { open: "09:00", close: "18:00", break: { start: "13:00", end: "14:00" } },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    })).toEqual({ ok: true });
    expect(validateMasterSchedule({
      mon: { open: "09:00", close: "18:00", break: { start: "09:00", end: "10:00" } },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    }).ok).toBe(true);
  });

  it("rejects close <= open", () => {
    expect(validateMasterSchedule({
      mon: { open: "18:00", close: "09:00" },
      tue: null, wed: null, thu: null, fri: null, sat: null, sun: null,
    })).toEqual({ ok: false, reason: "range", day: "mon" });
  });

  it("rejects an inverted break", () => {
    expect(validateMasterSchedule({
      mon: null, tue: { open: "09:00", close: "18:00", break: { start: "14:00", end: "13:00" } },
      wed: null, thu: null, fri: null, sat: null, sun: null,
    })).toEqual({ ok: false, reason: "break_range", day: "tue" });
  });

  it("rejects a break outside working hours", () => {
    expect(validateMasterSchedule({
      mon: null, tue: { open: "09:00", close: "12:00", break: { start: "13:00", end: "14:00" } },
      wed: null, thu: null, fri: null, sat: null, sun: null,
    })).toEqual({ ok: false, reason: "break_outside", day: "tue" });
  });

  it("a fully-loaded schedule fits under the 2000-char updateMaster cap", () => {
    const full = Object.fromEntries(
      WEEKDAY_KEYS.map((d) => [d, { open: "09:00", close: "18:00", break: { start: "13:00", end: "14:00" } }]),
    ) as MasterScheduleState;
    expect(serializeMasterSchedule(full).length).toBeLessThan(2000);
  });
});
