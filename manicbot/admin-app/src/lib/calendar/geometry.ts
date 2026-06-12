/**
 * Shared time-grid geometry for the day/week calendar views (DC-5 dedup
 * 2026-06-12). SalonDayView and SalonWeekView hand-copied identical
 * pad / fmtIsoDate / parseHHMMToMinutes / timeToTop / durationToHeight
 * helpers, differing only by the per-view `HOUR_HEIGHT` (56 day vs 48 week).
 * The pixel helpers are produced by `makeTimeGeometry(hourHeight)` so each
 * view keeps its own density while the maths lives in one place.
 *
 * `parseHHMMToMinutes` and the 15-minute minimum-height clamp are pinned by
 * the existing SalonDayView / SalonWeekView render tests.
 */

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseHHMMToMinutes(hhmm: string | undefined): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

export interface TimeGeometry {
  /** Absolute pixel offset of a HH:MM time below the visible window top. */
  timeToTop: (hhmm: string, hourStart: number) => number;
  /** Pixel height for a duration (min 15-minute slot so tiny events stay tappable). */
  durationToHeight: (durationMin: number | null | undefined) => number;
}

export function makeTimeGeometry(hourHeight: number): TimeGeometry {
  return {
    timeToTop(hhmm, hourStart) {
      const minutes = parseHHMMToMinutes(hhmm);
      const start = hourStart * 60;
      return ((minutes - start) / 60) * hourHeight;
    },
    durationToHeight(durationMin) {
      const d = Math.max(15, durationMin ?? 60); // minimum visible height = 15min slot
      return (d / 60) * hourHeight;
    },
  };
}
