/**
 * JS color values for the AUTHENTICATED-APP palette (beige + red + turquoise).
 *
 * CSS tokens in src/styles/globals.css are the source of truth for anything
 * stylable with a class. This module is ONLY for code that needs a raw color
 * VALUE in JS — SVG strokes/gradient stops, <canvas>, and per-entity event
 * hues — where a CSS variable can't be used directly.
 *
 * Values here mirror the `[data-app="authed"]` token blocks in globals.css.
 * Keep them in sync; the contrast gate (theme-tokens-contrast.test.ts) covers
 * the CSS side. Prefer `stroke="var(--color-primary)"` etc. when a CSS var
 * works — reach for this module only when it doesn't.
 */

export type ThemeName = "light" | "dark";

/** Semantic palette per theme — mirrors globals.css `[data-app="authed"]`. */
export const PALETTE = {
  light: {
    background: "#f7f0e6",
    foreground: "#2e2722",
    card: "#fffdf8",
    surfaceMuted: "#efe5d6",
    border: "#e2d4bf",
    mutedForeground: "#6f645b",
    primary: "#d14638",
    primaryHover: "#b23a30",
    secondary: "#1ea896",
    secondaryText: "#0b6f62",
    success: "#1f7a58",
    warning: "#c9892f",
    warningStrong: "#8a5d18",
    danger: "#c0392b",
  },
  dark: {
    background: "#1c1714",
    foreground: "#f2e8da",
    card: "#26201b",
    surfaceMuted: "#2f2823",
    border: "#3d342c",
    mutedForeground: "#b8a993",
    primary: "#e8604f",
    primaryHover: "#f07260",
    secondary: "#34c5b0",
    secondaryText: "#34c5b0",
    success: "#5fbe97",
    warning: "#e0a85a",
    warningStrong: "#e0a85a",
    danger: "#e5705f",
  },
} as const;

export function paletteFor(theme: ThemeName): (typeof PALETTE)[ThemeName] {
  return PALETTE[theme];
}

/**
 * Per-master event hues for the calendar (month/week/day must agree, so this
 * is the single source — components index into it by master order). Mid-tone
 * jewel/warm hues chosen to read on BOTH the beige-light and beige-dark
 * surfaces and to feel cohesive with the red+turquoise brand. Replaces the
 * ad-hoc 8-color arrays previously duplicated across calendar views.
 */
export const MASTER_EVENT_HUES = [
  "#d14638", // coral red (brand)
  "#1ea896", // turquoise (brand)
  "#e08a3c", // amber
  "#c75d8b", // rose
  "#4f8fc0", // sky
  "#3fa06b", // green
  "#b5683e", // terracotta
  "#8268c9", // violet
] as const;

/** Resolve a master's event hue by stable index (wraps after 8). */
export function masterHue(index: number): string {
  const hues = MASTER_EVENT_HUES;
  return hues[((index % hues.length) + hues.length) % hues.length] as string;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Full color set for a master's calendar events, derived from the master's
 * hue. `dot`/`text` are the solid hue; `bg`/`border` are translucent tints for
 * event blocks. Single source so month/week/day/agenda/rail agree per master.
 */
export function masterHueSet(index: number): {
  dot: string;
  text: string;
  bg: string;
  border: string;
} {
  const hue = masterHue(index);
  const [r, g, b] = hexToRgb(hue);
  return {
    dot: hue,
    text: hue,
    bg: `rgba(${r},${g},${b},0.16)`,
    border: `rgba(${r},${g},${b},0.5)`,
  };
}

/**
 * Appointment-status event colors for the calendar, theme-aware. Mirrors the
 * semantic status palette in lib/appointments.ts (pending=amber,
 * confirmed=emerald, done=violet, cancelled/rejected=red, no_show=orange) —
 * these stay as universal status hues (not the brand red/turquoise) so they
 * read as status, not decoration. `done` is violet to stay distinct from the
 * red brand and red cancelled. Each entry: tinted `bg`, solid `text`, `border`.
 */
export type StatusKey =
  | "pending"
  | "confirmed"
  | "done"
  | "cancelled"
  | "rejected"
  | "no_show";

type StatusHue = { bg: string; text: string; border: string };

export const STATUS_HUES: Record<ThemeName, Record<StatusKey, StatusHue>> = {
  light: {
    pending:   { bg: "rgba(245,158,11,0.14)", text: "#b45309", border: "rgba(245,158,11,0.30)" },
    confirmed: { bg: "rgba(16,185,129,0.14)", text: "#047857", border: "rgba(16,185,129,0.30)" },
    done:      { bg: "rgba(124,58,237,0.14)", text: "#6d28d9", border: "rgba(124,58,237,0.30)" },
    cancelled: { bg: "rgba(239,68,68,0.12)",  text: "#b91c1c", border: "rgba(239,68,68,0.30)" },
    rejected:  { bg: "rgba(239,68,68,0.12)",  text: "#b91c1c", border: "rgba(239,68,68,0.30)" },
    no_show:   { bg: "rgba(249,115,22,0.12)", text: "#c2410c", border: "rgba(249,115,22,0.30)" },
  },
  dark: {
    pending:   { bg: "rgba(245,158,11,0.18)", text: "#fbbf24", border: "rgba(245,158,11,0.38)" },
    confirmed: { bg: "rgba(16,185,129,0.18)", text: "#34d399", border: "rgba(16,185,129,0.38)" },
    done:      { bg: "rgba(124,58,237,0.20)", text: "#a78bfa", border: "rgba(124,58,237,0.40)" },
    cancelled: { bg: "rgba(239,68,68,0.18)",  text: "#f87171", border: "rgba(239,68,68,0.38)" },
    rejected:  { bg: "rgba(239,68,68,0.18)",  text: "#f87171", border: "rgba(239,68,68,0.38)" },
    no_show:   { bg: "rgba(249,115,22,0.18)", text: "#fb923c", border: "rgba(249,115,22,0.38)" },
  },
} as const;

/** Resolve a status hue for a theme, falling back to `pending` for unknowns. */
export function statusHue(status: string, theme: ThemeName): StatusHue {
  const table = STATUS_HUES[theme];
  return table[status as StatusKey] ?? table.pending;
}
