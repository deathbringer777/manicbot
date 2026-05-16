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

export const DEFAULT_WORK_HOURS: WorkHoursState = {
  mon: { open: "09:00", close: "18:00" },
  tue: { open: "09:00", close: "18:00" },
  wed: { open: "09:00", close: "18:00" },
  thu: { open: "09:00", close: "18:00" },
  fri: { open: "09:00", close: "18:00" },
  sat: { open: "10:00", close: "16:00" },
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
