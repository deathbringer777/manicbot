/**
 * Per-day master schedule resolution for the booking engine — the JS twin of
 * admin-app/src/lib/workHours.ts. Understands BOTH the new per-day shape
 *   workHours = {"days":{"mon":{"open":"09:00","close":"18:00","break":{"start":"13:00","end":"14:00"}}, …}}
 * and the legacy shape
 *   workHours = {"from":9,"to":18}  +  workDays = [1,2,3,4,5,6]   (0=Sun … 6=Sat)
 * returning the concrete working window + breaks for a given UTC weekday so
 * getSlots() can generate (and break-exclude) bookable slots.
 *
 * Keep this file in lockstep with admin-app/src/lib/workHours.ts — the two
 * encoders/decoders must agree on the {days} JSON. Contract pinned by
 * test/master-schedule.test.js and test/master-selection.test.js.
 */
import { WORK } from '../config.js';

// UTC weekday index → weekday key (Date.getUTCDay: Sunday = 0).
const DOW_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "HH:MM" → fractional hours (e.g. "13:30" → 13.5). Passes numbers through. */
function hhmmToFloat(v) {
  if (typeof v === 'number') return v;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v));
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/**
 * Resolve a master's working window for a UTC weekday.
 *
 * @param {object|null} master  master doc (workHours/workDays already parsed) from masterRowToDoc
 * @param {number} dow          UTC weekday 0..6 (Date.getUTCDay), Sunday = 0
 * @returns {{open:number, close:number, breaks:{start:number,end:number}[]}|null}
 *          null = day off / invalid (caller returns no slots).
 */
export function resolveMasterDay(master, dow) {
  const wh = master?.workHours;

  // New per-day shape: {days:{…}}
  if (wh && typeof wh === 'object' && wh.days && typeof wh.days === 'object') {
    const day = wh.days[DOW_TO_KEY[dow]];
    if (!day || typeof day !== 'object') return null; // day off
    const open = hhmmToFloat(day.open);
    const close = hhmmToFloat(day.close);
    if (open == null || close == null || close <= open) return null;
    const breaks = [];
    if (day.break && typeof day.break === 'object') {
      const start = hhmmToFloat(day.break.start);
      const end = hhmmToFloat(day.break.end);
      if (start != null && end != null && end > start) breaks.push({ start, end });
    }
    return { open, close, breaks };
  }

  // Legacy shape: {from,to} window + workDays[] gate (empty/absent ⇒ every day).
  if (Array.isArray(master?.workDays) && master.workDays.length > 0
      && !master.workDays.includes(dow)) {
    return null;
  }
  let open = WORK.from;
  let close = WORK.to;
  if (wh && typeof wh === 'object') {
    if (typeof wh.from === 'number') open = wh.from;
    if (typeof wh.to === 'number') close = wh.to;
  }
  return { open, close, breaks: [] };
}
