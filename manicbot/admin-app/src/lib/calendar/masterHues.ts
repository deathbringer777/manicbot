/**
 * Single source of truth for the per-master colour sequence used across every
 * calendar surface (DC-6, dedup 2026-06-12). Previously the same 8-hue
 * sequence was hand-copied into five files (SalonDayView / SalonWeekView /
 * SalonAgendaView / CalendarLeftRail / MonthCalendar), each in a slightly
 * different SHAPE — so editing one silently desynced a master's rail dot from
 * its grid-block colour.
 *
 * Each hue has two channels:
 *   - `accent` — the saturated text/dot/cell colour (darker).
 *   - `fill`   — the "r,g,b" triple for the lighter block background/border.
 * The three derived palettes below reproduce the exact shapes the call sites
 * used; `masterHues.test.ts` pins them byte-for-byte against the originals.
 */
export const MASTER_HUES = [
  { accent: "#7c3aed", fill: "124,58,237" }, // brand purple
  { accent: "#0b9b6b", fill: "11,155,107" }, // accent green
  { accent: "#0891b2", fill: "6,182,212" }, // cyan
  { accent: "#ec4899", fill: "244,114,182" }, // pink
  { accent: "#d97706", fill: "245,158,11" }, // amber
  { accent: "#2563eb", fill: "59,130,246" }, // blue
  { accent: "#9333ea", fill: "168,85,247" }, // violet
  { accent: "#0d9488", fill: "20,184,166" }, // teal
] as const;

/** Day/Week grid blocks: translucent fill + border, saturated text. */
export const MASTER_BLOCK_PALETTE = MASTER_HUES.map((h) => ({
  bg: `rgba(${h.fill},0.18)`,
  border: `rgba(${h.fill},0.55)`,
  text: h.accent,
})) as ReadonlyArray<{ bg: string; border: string; text: string }>;

/** Left-rail "My calendars" toggle: accent dot + faint fill. */
export const MASTER_RAIL_PALETTE = MASTER_HUES.map((h) => ({
  dot: h.accent,
  bg: `rgba(${h.fill},0.15)`,
})) as ReadonlyArray<{ dot: string; bg: string }>;

/** Agenda / Month: bare accent hex. */
export const MASTER_ACCENT_PALETTE = MASTER_HUES.map((h) => h.accent) as readonly string[];
