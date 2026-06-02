/**
 * Shared 30-minute time-of-day options for the schedule editors (salon
 * WorkHoursEditor + per-master MasterScheduleEditor). Lifted here so both
 * editors use one identical grid and never drift.
 */
import type { SelectOption } from "~/components/ui/Select";

/** 30-minute grid "00:00".."23:30" — 48 slots, built once. */
export const BASE_TIME_OPTIONS: SelectOption[] = (() => {
  const out: SelectOption[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const v = `${hh}:${mm}`;
    out.push({ value: v, label: v });
  }
  return out;
})();

/**
 * Time options that always include `current`, even if it isn't on the
 * 30-minute grid (e.g. a legacy "09:15" written by an old native time input).
 * Returns the stable module-level array for on-grid values so Select doesn't
 * see a new options identity every render.
 */
export function optionsWith(current: string): SelectOption[] {
  if (!current || BASE_TIME_OPTIONS.some((o) => o.value === current)) return BASE_TIME_OPTIONS;
  return [...BASE_TIME_OPTIONS, { value: current, label: current }].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}
