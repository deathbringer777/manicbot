/**
 * Recurrence DSL — pure, no D1 / no zod / no runtime deps.
 *
 * Shared between the admin-app (form validation, calendar chip expansion)
 * and the worker cron (occurrence-in-window scan). The worker keeps a JS
 * mirror at manicbot/src/lib/recurrence.js — both files MUST stay in sync.
 * The shared test cases live in both packages so a divergence is caught
 * by CI before deploy.
 *
 * Anchor model: a recurrence is interpreted relative to a YYYY-MM-DD anchor
 * date + HH:MM time. expandOccurrences() returns a list of Date objects
 * (in UTC) for every occurrence whose wall-clock time falls in the [from, to]
 * window. The caller is responsible for translating anchor/time pairs into
 * the right timezone — these functions treat anchor + time as already-UTC
 * for simplicity. The worker copy applies the tenant TZ offset before
 * invoking expansion (e.g. recurring platform campaigns in
 * src/services/platformCampaigns.js).
 *
 * Why no rrule library: cloudflare-workers + edge runtime + 8 KB plugin
 * settings budget. RFC 5545 RRULE is 10× our needs (we don't support
 * BYSETPOS / BYWEEKNO / nested overrides). A focused DSL is auditable
 * in 100 lines and validated by hand-written zod at the boundary.
 */

export type RecurrenceOnce = { type: "once" };

export type RecurrenceDaily = {
  type: "daily";
  /** HH:MM 24-hour. */
  time: string;
  /** Optional inclusive end date YYYY-MM-DD. */
  until?: string;
};

export type RecurrenceWeekly = {
  type: "weekly";
  time: string;
  /** ISO weekday numbers, 1=Mon..7=Sun. At least one. */
  weekdays: number[];
  until?: string;
};

export type RecurrenceMonthlyDay = {
  type: "monthly_day";
  time: string;
  /** Day of month, 1..28 (capped to avoid Feb-29 edge cases for MVP). */
  dayOfMonth: number;
  until?: string;
};

export type Recurrence =
  | RecurrenceOnce
  | RecurrenceDaily
  | RecurrenceWeekly
  | RecurrenceMonthlyDay;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Throws on bad input. Returns the same value typed. */
export function validateRecurrence(value: unknown): Recurrence {
  if (!value || typeof value !== "object") {
    throw new Error("recurrence: must be an object");
  }
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case "once":
      return { type: "once" };
    case "daily":
      requireTime(v.time);
      maybeUntil(v.until);
      return { type: "daily", time: v.time as string, until: v.until as string | undefined };
    case "weekly": {
      requireTime(v.time);
      if (!Array.isArray(v.weekdays) || v.weekdays.length === 0) {
        throw new Error("recurrence.weekly: weekdays must be a non-empty array");
      }
      const wd = v.weekdays.map((n) => {
        if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 7) {
          throw new Error("recurrence.weekly: weekday must be integer 1..7");
        }
        return n;
      });
      // Dedup + sort so equality checks and DB JSON match between callers.
      const uniq = Array.from(new Set(wd)).sort((a, b) => a - b);
      maybeUntil(v.until);
      return { type: "weekly", time: v.time as string, weekdays: uniq, until: v.until as string | undefined };
    }
    case "monthly_day": {
      requireTime(v.time);
      const d = v.dayOfMonth;
      if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 28) {
        throw new Error("recurrence.monthly_day: dayOfMonth must be integer 1..28");
      }
      maybeUntil(v.until);
      return {
        type: "monthly_day",
        time: v.time as string,
        dayOfMonth: d,
        until: v.until as string | undefined,
      };
    }
    default:
      throw new Error(`recurrence: unknown type "${String(v.type)}"`);
  }
}

function requireTime(t: unknown): asserts t is string {
  if (typeof t !== "string" || !TIME_RE.test(t)) {
    throw new Error("recurrence: time must match HH:MM (24h)");
  }
}

function maybeUntil(u: unknown): void {
  if (u === undefined || u === null) return;
  if (typeof u !== "string" || !DATE_RE.test(u)) {
    throw new Error("recurrence: until must match YYYY-MM-DD or be omitted");
  }
}

/**
 * Expand recurrence to UTC Date occurrences whose timestamp falls inside the
 * [from, to] window. `anchor` is the starts_on date YYYY-MM-DD.
 *
 * - `once`: returns at most one Date = anchor + time IF in window.
 * - `daily`: returns one Date per day in [from, to], anchor-and-after, until-or-forever.
 * - `weekly`: same but only when the day's ISO weekday is in `weekdays`.
 * - `monthly_day`: same but only when the day-of-month matches.
 *
 * Time is wall-clock UTC for the purposes of this pure function. Callers that
 * need local-TZ semantics convert their window to UTC before invoking.
 */
export function expandOccurrences(
  rec: Recurrence,
  anchor: string,
  from: Date,
  to: Date,
): Date[] {
  if (!DATE_RE.test(anchor)) {
    throw new Error("expandOccurrences: anchor must match YYYY-MM-DD");
  }
  if (!(from instanceof Date) || !(to instanceof Date) || from > to) {
    throw new Error("expandOccurrences: from must be a Date <= to");
  }
  const anchorMs = parseYmdUtc(anchor).getTime();

  // ─── once ───
  if (rec.type === "once") {
    // For 'once' we treat the anchor itself (date only) as the firing instant
    // at 00:00 UTC unless a `time` is conceptually paired. Caller passes anchor +
    // already-resolved time at the row-level (we don't store time inside the
    // 'once' variant). We assume the caller already filtered by anchor falling
    // in the window. To be safe, emit the anchor IF it lies in [from, to].
    const dt = new Date(anchorMs);
    return dt >= from && dt <= to ? [dt] : [];
  }

  const time = rec.time;
  const [hh, mm] = parseHhmm(time);
  const untilMs = rec.until ? parseYmdUtc(rec.until).getTime() + 86_400_000 - 1 : Number.POSITIVE_INFINITY;

  // Effective scan window = intersection of [from, to] with [anchor, until].
  const scanStartMs = Math.max(from.getTime(), anchorMs);
  const scanEndMs = Math.min(to.getTime(), untilMs);
  if (scanStartMs > scanEndMs) return [];

  const out: Date[] = [];
  // Walk day-by-day starting from the UTC midnight of scanStartMs.
  const dayMs = 86_400_000;
  const firstDayUtc = utcMidnight(scanStartMs);
  for (let d = firstDayUtc; d <= scanEndMs; d += dayMs) {
    const day = new Date(d);
    const occ = new Date(Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hh,
      mm,
      0,
      0,
    ));
    const occMs = occ.getTime();
    if (occMs < scanStartMs || occMs > scanEndMs) continue;
    if (rec.type === "daily") {
      out.push(occ);
    } else if (rec.type === "weekly") {
      const iso = isoWeekday(day);
      if (rec.weekdays.includes(iso)) out.push(occ);
    } else if (rec.type === "monthly_day") {
      if (day.getUTCDate() === rec.dayOfMonth) out.push(occ);
    }
  }
  return out;
}

/**
 * Cheap helper: first occurrence strictly after `after`. Returns null if
 * recurrence has run out (`until` past, or 'once' anchor in the past).
 * Used for the "Next: tomorrow at 09:00" hint in the detail panel.
 */
export function nextOccurrenceAfter(rec: Recurrence, anchor: string, after: Date): Date | null {
  if (!DATE_RE.test(anchor)) {
    throw new Error("nextOccurrenceAfter: anchor must match YYYY-MM-DD");
  }
  if (rec.type === "once") {
    const dt = parseYmdUtc(anchor);
    return dt > after ? dt : null;
  }
  const untilMs = rec.until ? parseYmdUtc(rec.until).getTime() + 86_400_000 - 1 : Number.POSITIVE_INFINITY;
  if (after.getTime() >= untilMs) return null;

  // Scan up to ~366 days forward. Beyond that something is misconfigured
  // (e.g. weekly with empty intersection). Caller logs.
  const [hh, mm] = parseHhmm(rec.time);
  const anchorMs = parseYmdUtc(anchor).getTime();
  const startMs = Math.max(anchorMs, utcMidnight(after.getTime()));
  for (let i = 0; i < 366; i += 1) {
    const dayMs = startMs + i * 86_400_000;
    if (dayMs > untilMs) return null;
    const day = new Date(dayMs);
    const occ = new Date(Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hh,
      mm,
      0,
      0,
    ));
    if (occ <= after) continue;
    if (rec.type === "daily") return occ;
    if (rec.type === "weekly" && rec.weekdays.includes(isoWeekday(day))) return occ;
    if (rec.type === "monthly_day" && day.getUTCDate() === rec.dayOfMonth) return occ;
  }
  return null;
}

// ─── helpers ──────────────────────────────────────────────────────────────

function parseYmdUtc(ymd: string): Date {
  const parts = ymd.split("-").map((s) => Number(s));
  // Already validated upstream by DATE_RE, so the cast is safe.
  return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
}

function parseHhmm(hhmm: string): [number, number] {
  const parts = hhmm.split(":").map((s) => Number(s));
  return [parts[0]!, parts[1]!];
}

function utcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Convert JS Date.getUTCDay() (0=Sun..6=Sat) to ISO weekday (1=Mon..7=Sun). */
function isoWeekday(d: Date): number {
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}
