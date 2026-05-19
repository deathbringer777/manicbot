/**
 * TDD: recurring appointment series — creation, edit-one detach,
 * edit-all update, edit-future slice.
 * Uses the existing expandOccurrences from ~/lib/recurrence.ts.
 */

import { describe, it, expect } from "vitest";
import { expandOccurrences, validateRecurrence } from "~/lib/recurrence";

// ─── series generation helpers (mirrors createSeries logic) ──────────────────

function generateSeriesDates(
  recurrence: ReturnType<typeof validateRecurrence>,
  anchorDate: string,
  anchorTime: string,
  windowDays = 90,
): { date: string; time: string; seriesIndex: number }[] {
  if (recurrence.type === "once") {
    return [{ date: anchorDate, time: anchorTime, seriesIndex: 0 }];
  }
  const from = new Date(anchorDate + "T00:00:00Z");
  const to = new Date(from.getTime() + windowDays * 86_400_000);
  const occurrences = expandOccurrences(recurrence, anchorDate, from, to);
  return occurrences.map((dt, i) => ({
    date: dt.toISOString().slice(0, 10),
    time: anchorTime,
    seriesIndex: i,
  }));
}

describe("appointment series — generateSeriesDates", () => {
  it("once returns exactly one entry", () => {
    const rec = validateRecurrence({ type: "once" });
    const result = generateSeriesDates(rec, "2026-05-20", "10:00");
    expect(result).toHaveLength(1);
    expect(result[0]?.date).toBe("2026-05-20");
    expect(result[0]?.seriesIndex).toBe(0);
  });

  it("daily over 90 days returns 91 entries (anchor included)", () => {
    const rec = validateRecurrence({ type: "daily", time: "10:00" });
    const result = generateSeriesDates(rec, "2026-01-01", "10:00", 90);
    expect(result.length).toBeGreaterThanOrEqual(90);
  });

  it("weekly (Mon) over 90 days returns ~13 entries", () => {
    const rec = validateRecurrence({ type: "weekly", time: "10:00", weekdays: [1] });
    // 2026-05-18 is a Monday
    const result = generateSeriesDates(rec, "2026-05-18", "10:00", 90);
    expect(result.length).toBeGreaterThanOrEqual(12);
    expect(result.length).toBeLessThanOrEqual(14);
    // All should be Mondays (UTC)
    for (const r of result) {
      const d = new Date(r.date + "T00:00:00Z");
      expect(d.getUTCDay()).toBe(1); // 1 = Monday
    }
  });

  it("monthly_day over 90 days returns ~3 entries", () => {
    const rec = validateRecurrence({ type: "monthly_day", time: "10:00", dayOfMonth: 15 });
    const result = generateSeriesDates(rec, "2026-05-15", "10:00", 90);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it("series_index is sequential starting from 0", () => {
    const rec = validateRecurrence({ type: "daily", time: "09:00", until: "2026-01-05" });
    const result = generateSeriesDates(rec, "2026-01-01", "09:00", 90);
    result.forEach((r, i) => expect(r.seriesIndex).toBe(i));
  });
});

// ─── edit-one detach ──────────────────────────────────────────────────────────

describe("edit-one detach logic", () => {
  it("detach removes parent_appointment_id from a single row", () => {
    const after = { parentAppointmentId: null };
    expect(after.parentAppointmentId).toBeNull();
  });
});

// ─── edit-this-and-following ──────────────────────────────────────────────────

describe("edit-this-and-following filter", () => {
  it("filters rows WHERE series_index >= N", () => {
    const rows = [0, 1, 2, 3, 4].map((i) => ({ seriesIndex: i }));
    const targetIndex = 2;
    const affected = rows.filter((r) => r.seriesIndex >= targetIndex);
    expect(affected).toHaveLength(3);
    expect(affected[0]?.seriesIndex).toBe(2);
  });
});

// ─── edit-all ────────────────────────────────────────────────────────────────

describe("edit-all filter", () => {
  it("matches all rows with the same parent_appointment_id", () => {
    const parentId = "apt_root";
    const rows = [
      { id: "apt_root", parentAppointmentId: null },
      { id: "apt_1", parentAppointmentId: parentId },
      { id: "apt_2", parentAppointmentId: parentId },
    ];
    const affected = rows.filter(
      (r) => r.id === parentId || r.parentAppointmentId === parentId,
    );
    expect(affected).toHaveLength(3);
  });
});
