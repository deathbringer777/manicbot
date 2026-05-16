import { describe, it, expect } from "vitest";
import {
  validateRecurrence,
  expandOccurrences,
  nextOccurrenceAfter,
} from "~/lib/recurrence";

// Identical cases to manicbot/test/recurrence.test.js — if the two diverge,
// CI fails on one side. The admin-app version + worker JS mirror are the
// canonical pair (no path alias shared between the two packages).

describe("validateRecurrence", () => {
  it("accepts once", () => {
    expect(validateRecurrence({ type: "once" })).toEqual({ type: "once" });
  });

  it("accepts daily with time", () => {
    expect(validateRecurrence({ type: "daily", time: "09:00" })).toEqual({
      type: "daily",
      time: "09:00",
      until: undefined,
    });
  });

  it("accepts weekly with weekdays + dedups and sorts", () => {
    const r = validateRecurrence({ type: "weekly", time: "09:00", weekdays: [3, 1, 5, 1] });
    expect(r).toEqual({ type: "weekly", time: "09:00", weekdays: [1, 3, 5], until: undefined });
  });

  it("rejects time with bad shape", () => {
    expect(() => validateRecurrence({ type: "daily", time: "9:00" })).toThrow(/time must match HH:MM/);
    expect(() => validateRecurrence({ type: "daily", time: "24:00" })).toThrow();
    expect(() => validateRecurrence({ type: "daily", time: "09:60" })).toThrow();
  });

  it("rejects weekly with empty weekdays", () => {
    expect(() => validateRecurrence({ type: "weekly", time: "09:00", weekdays: [] })).toThrow(/non-empty/);
  });

  it("rejects weekly weekday out of range", () => {
    expect(() => validateRecurrence({ type: "weekly", time: "09:00", weekdays: [0] })).toThrow(/1\.\.7/);
    expect(() => validateRecurrence({ type: "weekly", time: "09:00", weekdays: [8] })).toThrow(/1\.\.7/);
  });

  it("rejects monthly_day outside 1..28", () => {
    expect(() => validateRecurrence({ type: "monthly_day", time: "09:00", dayOfMonth: 0 })).toThrow();
    expect(() => validateRecurrence({ type: "monthly_day", time: "09:00", dayOfMonth: 29 })).toThrow();
  });

  it("rejects until with wrong shape", () => {
    expect(() => validateRecurrence({ type: "daily", time: "09:00", until: "2026/12/31" })).toThrow(/YYYY-MM-DD/);
  });

  it("rejects unknown type", () => {
    expect(() => validateRecurrence({ type: "yearly", time: "09:00" })).toThrow(/unknown type/);
  });

  it("rejects non-object input", () => {
    expect(() => validateRecurrence(null)).toThrow();
    expect(() => validateRecurrence("once")).toThrow();
  });
});

describe("expandOccurrences", () => {
  const anchor = "2026-05-18"; // Monday
  const from = new Date(Date.UTC(2026, 4, 18, 0, 0, 0));
  const to = new Date(Date.UTC(2026, 4, 24, 23, 59, 59));

  it("once: returns anchor when inside window", () => {
    const occs = expandOccurrences({ type: "once" }, anchor, from, to);
    expect(occs).toHaveLength(1);
    expect(occs[0]!.toISOString()).toBe("2026-05-18T00:00:00.000Z");
  });

  it("once: returns empty when anchor before window", () => {
    const earlier = new Date(Date.UTC(2026, 4, 19, 0, 0, 0));
    expect(expandOccurrences({ type: "once" }, anchor, earlier, to)).toHaveLength(0);
  });

  it("daily: emits one per day in window", () => {
    const occs = expandOccurrences({ type: "daily", time: "09:00" }, anchor, from, to);
    expect(occs).toHaveLength(7);
    expect(occs[0]!.toISOString()).toBe("2026-05-18T09:00:00.000Z");
    expect(occs[6]!.toISOString()).toBe("2026-05-24T09:00:00.000Z");
  });

  it("weekly Mon/Wed/Fri: emits 3 across the week", () => {
    const occs = expandOccurrences(
      { type: "weekly", time: "09:00", weekdays: [1, 3, 5] },
      anchor, from, to,
    );
    expect(occs.map((d) => d.toISOString())).toEqual([
      "2026-05-18T09:00:00.000Z",
      "2026-05-20T09:00:00.000Z",
      "2026-05-22T09:00:00.000Z",
    ]);
  });

  it("weekly Sun (ISO 7): includes Sunday", () => {
    const occs = expandOccurrences(
      { type: "weekly", time: "09:00", weekdays: [7] },
      anchor, from, to,
    );
    expect(occs).toHaveLength(1);
    expect(occs[0]!.toISOString()).toBe("2026-05-24T09:00:00.000Z");
  });

  it("monthly_day: only the matching day", () => {
    const from2 = new Date(Date.UTC(2026, 4, 1, 0, 0, 0));
    const to2 = new Date(Date.UTC(2026, 7, 1, 0, 0, 0));
    const occs = expandOccurrences(
      { type: "monthly_day", time: "09:00", dayOfMonth: 15 },
      "2026-05-01", from2, to2,
    );
    expect(occs.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
    ]);
  });

  it("honors until cutoff", () => {
    const occs = expandOccurrences(
      { type: "daily", time: "09:00", until: "2026-05-20" },
      anchor, from, to,
    );
    expect(occs).toHaveLength(3);
    expect(occs[2]!.toISOString()).toBe("2026-05-20T09:00:00.000Z");
  });

  it("honors anchor (does not emit before)", () => {
    const occs = expandOccurrences(
      { type: "daily", time: "09:00" },
      "2026-05-22", from, to,
    );
    expect(occs.map((d) => d.toISOString())).toEqual([
      "2026-05-22T09:00:00.000Z",
      "2026-05-23T09:00:00.000Z",
      "2026-05-24T09:00:00.000Z",
    ]);
  });

  it("rejects from > to", () => {
    expect(() => expandOccurrences({ type: "daily", time: "09:00" }, anchor, to, from)).toThrow();
  });

  it("rejects bad anchor", () => {
    expect(() => expandOccurrences({ type: "daily", time: "09:00" }, "2026/05/18", from, to)).toThrow();
  });
});

describe("nextOccurrenceAfter", () => {
  it("once: returns anchor when in future", () => {
    const after = new Date(Date.UTC(2026, 4, 17, 0, 0, 0));
    expect(nextOccurrenceAfter({ type: "once" }, "2026-05-18", after)?.toISOString())
      .toBe("2026-05-18T00:00:00.000Z");
  });

  it("once: returns null when anchor already past", () => {
    const after = new Date(Date.UTC(2026, 4, 19, 0, 0, 0));
    expect(nextOccurrenceAfter({ type: "once" }, "2026-05-18", after)).toBeNull();
  });

  it("daily: returns next day at fire time if today already fired", () => {
    const after = new Date(Date.UTC(2026, 4, 18, 10, 0, 0));
    const next = nextOccurrenceAfter({ type: "daily", time: "09:00" }, "2026-05-18", after);
    expect(next?.toISOString()).toBe("2026-05-19T09:00:00.000Z");
  });

  it("daily: returns today if fire time still in future", () => {
    const after = new Date(Date.UTC(2026, 4, 18, 8, 0, 0));
    const next = nextOccurrenceAfter({ type: "daily", time: "09:00" }, "2026-05-18", after);
    expect(next?.toISOString()).toBe("2026-05-18T09:00:00.000Z");
  });

  it("weekly Mon/Wed/Fri: skips to next matching weekday", () => {
    const after = new Date(Date.UTC(2026, 4, 18, 10, 0, 0));
    const next = nextOccurrenceAfter(
      { type: "weekly", time: "09:00", weekdays: [1, 3, 5] },
      "2026-05-18", after,
    );
    expect(next?.toISOString()).toBe("2026-05-20T09:00:00.000Z");
  });

  it("returns null past until cutoff", () => {
    const after = new Date(Date.UTC(2026, 4, 21, 0, 0, 0));
    const next = nextOccurrenceAfter(
      { type: "daily", time: "09:00", until: "2026-05-20" },
      "2026-05-18", after,
    );
    expect(next).toBeNull();
  });
});
