/** Current Unix timestamp in seconds (integer). Use instead of inlined
 *  `Math.floor(Date.now() / 1000)` for consistency. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const WARSAW_TZ = "Europe/Warsaw";

/**
 * Convert a Warsaw wall-clock date/time to a UTC epoch in MILLISECONDS — the
 * canonical unit for `appointments.ts` across the Worker bot, cron reminders,
 * Google Calendar sync, monthly stats and phase-cleanup. `month` is 1-indexed
 * (1 = January). DST-correct: it brute-forces the UTC+1 (CET) / UTC+2 (CEST)
 * offset that round-trips back to the requested Warsaw wall clock.
 *
 * Ported from the Worker's `src/utils/date.js` `warsawToUTC()` so both writers
 * share one formula and the admin-app stops storing seconds + raw UTC
 * (BUG-01/BUG-04). Returns ms so call sites read `ts: warsawToUtcMs(...)`.
 */
export function warsawToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  for (const offset of [1, 2]) {
    const utc = new Date(Date.UTC(year, month - 1, day, hour - offset, minute));
    const p: Record<string, string> = {};
    for (const { type, value } of new Intl.DateTimeFormat("en-CA", {
      timeZone: WARSAW_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(utc)) {
      p[type] = value;
    }
    if (
      parseInt(p.hour!) % 24 === hour &&
      parseInt(p.day!) === day &&
      parseInt(p.month!) === month
    ) {
      return utc.getTime();
    }
  }
  return Date.UTC(year, month - 1, day, hour - 1, minute);
}
