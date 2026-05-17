/**
 * Recurrence DSL — worker copy (JS mirror of admin-app/src/lib/recurrence.ts).
 *
 * Pure functions, no D1 / no zod. The two copies MUST stay in sync — shared
 * Vitest cases live in both packages so divergence is caught by CI before
 * deploy. When editing one, edit the other.
 *
 * See the admin-app source for the full design rationale (why no rrule).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateRecurrence(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('recurrence: must be an object');
  }
  switch (value.type) {
    case 'once':
      return { type: 'once' };
    case 'daily':
      requireTime(value.time);
      maybeUntil(value.until);
      return { type: 'daily', time: value.time, until: value.until };
    case 'weekly': {
      requireTime(value.time);
      if (!Array.isArray(value.weekdays) || value.weekdays.length === 0) {
        throw new Error('recurrence.weekly: weekdays must be a non-empty array');
      }
      const wd = value.weekdays.map((n) => {
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 7) {
          throw new Error('recurrence.weekly: weekday must be integer 1..7');
        }
        return n;
      });
      const uniq = Array.from(new Set(wd)).sort((a, b) => a - b);
      maybeUntil(value.until);
      return { type: 'weekly', time: value.time, weekdays: uniq, until: value.until };
    }
    case 'monthly_day': {
      requireTime(value.time);
      const d = value.dayOfMonth;
      if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 28) {
        throw new Error('recurrence.monthly_day: dayOfMonth must be integer 1..28');
      }
      maybeUntil(value.until);
      return { type: 'monthly_day', time: value.time, dayOfMonth: d, until: value.until };
    }
    default:
      throw new Error(`recurrence: unknown type "${String(value.type)}"`);
  }
}

function requireTime(t) {
  if (typeof t !== 'string' || !TIME_RE.test(t)) {
    throw new Error('recurrence: time must match HH:MM (24h)');
  }
}

function maybeUntil(u) {
  if (u === undefined || u === null) return;
  if (typeof u !== 'string' || !DATE_RE.test(u)) {
    throw new Error('recurrence: until must match YYYY-MM-DD or be omitted');
  }
}

export function expandOccurrences(rec, anchor, from, to) {
  if (!DATE_RE.test(anchor)) {
    throw new Error('expandOccurrences: anchor must match YYYY-MM-DD');
  }
  if (!(from instanceof Date) || !(to instanceof Date) || from > to) {
    throw new Error('expandOccurrences: from must be a Date <= to');
  }
  const anchorMs = parseYmdUtc(anchor).getTime();

  if (rec.type === 'once') {
    const dt = new Date(anchorMs);
    return dt >= from && dt <= to ? [dt] : [];
  }

  const [hh, mm] = rec.time.split(':').map((s) => Number(s));
  const untilMs = rec.until ? parseYmdUtc(rec.until).getTime() + 86_400_000 - 1 : Number.POSITIVE_INFINITY;
  const scanStartMs = Math.max(from.getTime(), anchorMs);
  const scanEndMs = Math.min(to.getTime(), untilMs);
  if (scanStartMs > scanEndMs) return [];

  const out = [];
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
    if (rec.type === 'daily') {
      out.push(occ);
    } else if (rec.type === 'weekly') {
      const iso = isoWeekday(day);
      if (rec.weekdays.includes(iso)) out.push(occ);
    } else if (rec.type === 'monthly_day') {
      if (day.getUTCDate() === rec.dayOfMonth) out.push(occ);
    }
  }
  return out;
}

export function nextOccurrenceAfter(rec, anchor, after) {
  if (!DATE_RE.test(anchor)) {
    throw new Error('nextOccurrenceAfter: anchor must match YYYY-MM-DD');
  }
  if (rec.type === 'once') {
    const dt = parseYmdUtc(anchor);
    return dt > after ? dt : null;
  }
  const untilMs = rec.until ? parseYmdUtc(rec.until).getTime() + 86_400_000 - 1 : Number.POSITIVE_INFINITY;
  if (after.getTime() >= untilMs) return null;

  const [hh, mm] = rec.time.split(':').map((s) => Number(s));
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
    if (rec.type === 'daily') return occ;
    if (rec.type === 'weekly' && rec.weekdays.includes(isoWeekday(day))) return occ;
    if (rec.type === 'monthly_day' && day.getUTCDate() === rec.dayOfMonth) return occ;
  }
  return null;
}

function parseYmdUtc(ymd) {
  const [y, m, d] = ymd.split('-').map((s) => Number(s));
  return new Date(Date.UTC(y, m - 1, d));
}

function utcMidnight(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function isoWeekday(d) {
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}
