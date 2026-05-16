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
