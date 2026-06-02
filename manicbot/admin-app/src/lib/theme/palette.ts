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
