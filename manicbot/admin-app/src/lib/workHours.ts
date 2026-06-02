/**
 * Shared work-hours encoding/decoding for the salon profile.
 *
 * Storage shape (JSON string, persisted under tenants.salon.workHours +
 * tenant_config.work_hours):
 *   {"days":{"mon":{"open":"09:00","close":"18:00"}, ..., "sun":null}}
 *
 * `null` for a weekday means "day off". We keep two legacy formats readable so
 * older tenant rows render correctly:
 *   - plain string "09:00 – 18:00" → applied Mon-Sat, Sun off
 *   - { from, to } numeric/string hours → same treatment
 *
 * Both the admin-app PublicProfileEditor and the public SalonProfileClient
 * consume these helpers, so the on-disk format stays in lockstep.
 */

export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];
export type DayHours = { open: string; close: string } | null;
export type WorkHoursState = Record<WeekdayKey, DayHours>;

// Default for a brand-new salon: Mon–Sat 09:00–18:00, Sunday off. Owners can
// override any day. (Was Sat 10:00–16:00 — aligned to the simpler "9–18 except
// Sunday" expectation surfaced by the salon-settings redesign.)
export const DEFAULT_WORK_HOURS: WorkHoursState = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "09:00", close: "18:00" },
  sun: null,
};

export function hydrateWorkHours(raw: unknown): WorkHoursState {
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.days && typeof parsed.days === "object") {
        const out = { ...DEFAULT_WORK_HOURS };
        for (const day of WEEKDAY_KEYS) {
          const v = (parsed.days as Record<string, unknown>)[day];
          if (v === null) { out[day] = null; continue; }
          if (v && typeof v === "object") {
            const obj = v as { open?: unknown; close?: unknown };
            if (typeof obj.open === "string" && typeof obj.close === "string") {
              out[day] = { open: obj.open, close: obj.close };
            }
          }
        }
        return out;
      }
    } catch { /* fall through to legacy */ }
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const m = raw.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/);
    if (m) {
      const open = m[1]!.padStart(5, "0");
      const close = m[2]!.padStart(5, "0");
      return {
        mon: { open, close }, tue: { open, close }, wed: { open, close },
        thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: null,
      };
    }
  }
  if (raw && typeof raw === "object") {
    const obj = raw as { from?: number | string; to?: number | string };
    if (obj.from !== undefined && obj.to !== undefined) {
      const fmt = (v: number | string) => typeof v === "string" ? v : String(v).padStart(2, "0") + ":00";
      const open = fmt(obj.from);
      const close = fmt(obj.to);
      return {
        mon: { open, close }, tue: { open, close }, wed: { open, close },
        thu: { open, close }, fri: { open, close }, sat: { open, close }, sun: null,
      };
    }
  }
  return { ...DEFAULT_WORK_HOURS };
}

export function serializeWorkHours(state: WorkHoursState): string {
  return JSON.stringify({ days: state });
}

/**
 * ── Per-master booking schedule ──────────────────────────────────────────
 *
 * A DIFFERENT shape from the salon-wide per-day hours above. The Worker
 * booking engine (src/services/appointments.js → getSlots) reads a master's
 * schedule as:
 *   - masters.work_hours: { from, to }  — one daily window, integer hours 0..24
 *   - masters.work_days:  number[]      — UTC weekdays the master works,
 *                                         0=Sun … 6=Sat (Date.getUTCDay).
 *                                         Empty/absent ⇒ every day.
 *
 * Both the owner editor (salon.updateMaster) and the master editor
 * (master.updateWorkHours) produce/parse exactly this shape so the UI stays in
 * lockstep with what booking actually enforces. The slot-generation contract
 * these helpers target is locked in by test/master-selection.test.js.
 */
export type MasterHours = { from: number; to: number };

const MASTER_HOUR_MIN = 0;
const MASTER_HOUR_MAX = 24;
const WEEKDAY_DOW_MIN = 0; // Sunday
const WEEKDAY_DOW_MAX = 6; // Saturday

/** True iff [from, to) is an in-order integer window inside [0, 24]. */
export function isValidMasterHours(from: number, to: number): boolean {
  return (
    Number.isInteger(from)
    && Number.isInteger(to)
    && from >= MASTER_HOUR_MIN
    && to <= MASTER_HOUR_MAX
    && from < to
  );
}

/** Serialize a daily window to the `{from,to}` JSON the Worker reads. Throws on an invalid window. */
export function serializeMasterHours(from: number, to: number): string {
  if (!isValidMasterHours(from, to)) throw new Error("invalid_master_hours");
  return JSON.stringify({ from, to });
}

/**
 * Parse stored master hours back to `{from,to}`. Accepts the JSON string or an
 * already-parsed object; returns null for the salon per-day shape, junk, or
 * anything that isn't a numeric `{from,to}` pair (no range validation here —
 * callers decide whether to reject or clamp).
 */
export function parseMasterHours(raw: unknown): MasterHours | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try { obj = JSON.parse(trimmed); } catch { return null; }
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const o = obj as { from?: unknown; to?: unknown };
    if (typeof o.from === "number" && typeof o.to === "number") {
      return { from: o.from, to: o.to };
    }
  }
  return null;
}

/** Normalize working weekdays to a sorted, de-duped 0..6 JSON array string. */
export function serializeMasterWorkDays(days: number[]): string {
  const clean = Array.from(new Set(days))
    .filter((d) => Number.isInteger(d) && d >= WEEKDAY_DOW_MIN && d <= WEEKDAY_DOW_MAX)
    .sort((a, b) => a - b);
  return JSON.stringify(clean);
}

/**
 * Parse stored workDays back to a number[] of valid weekdays (0..6), dropping
 * out-of-range entries. Returns null when the input isn't a JSON array at all
 * (so a caller can reject a malformed payload rather than silently store []).
 */
export function parseMasterWorkDays(raw: unknown): number[] | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try { arr = JSON.parse(trimmed); } catch { return null; }
  }
  if (!Array.isArray(arr)) return null;
  return arr.filter(
    (d): d is number => Number.isInteger(d) && d >= WEEKDAY_DOW_MIN && d <= WEEKDAY_DOW_MAX,
  );
}

/**
 * Decode the per-day JSON shape only — used by the public renderer when it
 * wants to display each weekday row independently. Returns null if `wh`
 * isn't the per-day shape, so the caller can fall back to legacy display.
 */
export function decodePerDayWorkHours(wh: unknown): DayHours[] | null {
  if (typeof wh !== "string" || !wh.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(wh);
    if (!parsed?.days || typeof parsed.days !== "object") return null;
    return WEEKDAY_KEYS.map((day) => {
      const v = (parsed.days as Record<string, unknown>)[day];
      if (v === null) return null;
      if (v && typeof v === "object") {
        const obj = v as { open?: unknown; close?: unknown };
        if (typeof obj.open === "string" && typeof obj.close === "string") {
          return { open: obj.open, close: obj.close };
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

/**
 * ── Per-day master schedule (per-day hours + ONE optional break) ──────────
 *
 * A richer evolution of the legacy `{from,to}` + `workDays[]` master shape
 * above. Stored in the SAME `masters.work_hours` TEXT column as:
 *   {"days":{"mon":{"open":"09:00","close":"18:00","break":{"start":"13:00","end":"14:00"}}, …, "sun":null}}
 * `null` for a weekday = day off; `break` omitted = no break (max one per day).
 *
 * `masters.work_days` is kept in sync as the derived sorted 0..6 array
 * (`deriveWorkDaysFromSchedule`) so the legacy Worker branch, the public salon
 * profile, and the onboarding `set_master_schedule` check keep working. The
 * Worker booking engine resolves BOTH the new and legacy shapes via the JS twin
 * src/services/masterSchedule.js → resolveMasterDay (kept in lockstep here).
 */
export type MasterBreak = { start: string; end: string };
export type MasterDaySchedule = { open: string; close: string; break?: MasterBreak } | null;
export type MasterScheduleState = Record<WeekdayKey, MasterDaySchedule>;

/** WeekdayKey ⇄ UTC weekday index (Date.getUTCDay): Sunday = 0, Saturday = 6. */
export const WEEKDAY_KEY_TO_DOW: Record<WeekdayKey, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
};
export const DOW_TO_WEEKDAY_KEY: Record<number, WeekdayKey> = {
  0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat",
};

/** Brand-new master: Mon–Sat 09:00–18:00, Sunday off — mirrors the old editor defaults. */
export const DEFAULT_MASTER_SCHEDULE: MasterScheduleState = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "09:00", close: "18:00" },
  sun: null,
};

/** Read a single day's value from a decoded `{days}` payload (defensive). */
function readMasterDay(v: unknown): MasterDaySchedule {
  if (!v || typeof v !== "object") return null;
  const o = v as { open?: unknown; close?: unknown; break?: unknown };
  if (typeof o.open !== "string" || typeof o.close !== "string") return null;
  const day: { open: string; close: string; break?: MasterBreak } = { open: o.open, close: o.close };
  if (o.break && typeof o.break === "object") {
    const b = o.break as { start?: unknown; end?: unknown };
    if (typeof b.start === "string" && typeof b.end === "string") {
      day.break = { start: b.start, end: b.end };
    }
  }
  return day;
}

/**
 * Decode ONLY the per-day `{days:{…}}` master shape. Returns null for the legacy
 * `{from,to}` master shape, the salon string format, or junk — so callers can
 * fall back to legacy hydration.
 */
export function decodeMasterSchedule(raw: unknown): MasterScheduleState | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) return null;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const days = (parsed as { days?: unknown }).days;
  if (!days || typeof days !== "object") return null;
  const out = {} as MasterScheduleState;
  for (const key of WEEKDAY_KEYS) {
    out[key] = readMasterDay((days as Record<string, unknown>)[key]);
  }
  return out;
}

/** Integer hour 0..24 → "HH:00" (legacy window endpoints). */
function intHourToHHMM(n: number): string {
  const clamped = Math.max(0, Math.min(24, Math.trunc(n)));
  return `${String(clamped).padStart(2, "0")}:00`;
}

/**
 * Load a master schedule for editing. Prefers the canonical per-day shape;
 * otherwise rebuilds it from the legacy `{from,to}` window + `workDays[]`
 * (empty/absent workDays ⇒ Mon–Sat, matching the previous editor default).
 */
export function hydrateMasterSchedule(rawWorkHours: unknown, rawWorkDays?: unknown): MasterScheduleState {
  const perDay = decodeMasterSchedule(rawWorkHours);
  if (perDay) return perDay;
  const hours = parseMasterHours(rawWorkHours) ?? { from: 9, to: 18 };
  const parsedDays = parseMasterWorkDays(rawWorkDays);
  const enabled = new Set(parsedDays && parsedDays.length > 0 ? parsedDays : [1, 2, 3, 4, 5, 6]);
  const open = intHourToHHMM(hours.from);
  const close = intHourToHHMM(hours.to);
  const out = {} as MasterScheduleState;
  for (const key of WEEKDAY_KEYS) {
    out[key] = enabled.has(WEEKDAY_KEY_TO_DOW[key]) ? { open, close } : null;
  }
  return out;
}

/** Serialize to the `{"days":{…}}` JSON persisted in `masters.work_hours`. */
export function serializeMasterSchedule(state: MasterScheduleState): string {
  return JSON.stringify({ days: state });
}

/** Sorted, de-duped 0..6 weekday indices for every enabled (non-null) day. */
export function deriveWorkDaysFromSchedule(state: MasterScheduleState): number[] {
  return WEEKDAY_KEYS
    .filter((key) => state[key] !== null)
    .map((key) => WEEKDAY_KEY_TO_DOW[key])
    .sort((a, b) => a - b);
}

/** "HH:MM" → minutes since midnight, or null if malformed. */
function hhmmToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export type MasterScheduleValidation =
  | { ok: true }
  | { ok: false; reason: "range" | "break_range" | "break_outside"; day: WeekdayKey };

/**
 * Validate a per-day master schedule. Rejects close<=open, an inverted break,
 * and a break outside the working window. A break touching either edge is allowed.
 * Returns the first offending day so the editor can flag the exact row.
 */
export function validateMasterSchedule(state: MasterScheduleState): MasterScheduleValidation {
  for (const day of WEEKDAY_KEYS) {
    const slot = state[day];
    if (slot === null) continue;
    const open = hhmmToMinutes(slot.open);
    const close = hhmmToMinutes(slot.close);
    if (open === null || close === null || close <= open) {
      return { ok: false, reason: "range", day };
    }
    if (slot.break) {
      const bs = hhmmToMinutes(slot.break.start);
      const be = hhmmToMinutes(slot.break.end);
      if (bs === null || be === null || be <= bs) {
        return { ok: false, reason: "break_range", day };
      }
      if (bs < open || be > close) {
        return { ok: false, reason: "break_outside", day };
      }
    }
  }
  return { ok: true };
}
