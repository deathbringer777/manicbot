/**
 * Theme token contrast gate — programmatic WCAG AA check on the
 * AUTHENTICATED-APP palette (beige + red + turquoise), both themes.
 *
 * Parses the actual `--token: #hex;` values out of src/styles/globals.css
 * (the single source of truth) — specifically the `[data-app="authed"]`
 * (light) and `.dark [data-app="authed"]` (dark) blocks — and asserts every
 * critical foreground/background pairing meets WCAG 2.1:
 *   • >= 4.5:1 for normal body text
 *   • >= 3:1   for large text / UI component boundaries (ring)
 *
 * This is the gate that catches the light-turquoise trap: white-on-turquoise
 * (#1EA896) is only 2.96:1, so a secondary button MUST use dark text. If a
 * future palette edit reintroduces a sub-AA pair, this test fails with the
 * exact ratio.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(
  join(__dirname, "..", "styles", "globals.css"),
  "utf8",
);

/** Extract `--name: #hex;` declarations from the block whose selector is
 *  exactly `selector` (matched up to the first closing brace; the token
 *  blocks contain no nested braces). */
function parseBlock(selector: string): Record<string, string> {
  // Escape regex metachars in the selector ([, ], ", .).
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc}\\s*\\{([^}]*)\\}`);
  const m = CSS.match(re);
  if (!m) throw new Error(`Block not found in globals.css: ${selector}`);
  const out: Record<string, string> = {};
  const declRe = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let d: RegExpExecArray | null;
  while ((d = declRe.exec(m[1] ?? "")) !== null) {
    out[d[1] as string] = (d[2] as string).toLowerCase();
  }
  return out;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

interface Pair {
  fg: string; // token name
  bg: string; // token name
  min: number;
  label: string;
}

// Critical pairings. `min` 4.5 = body text; 3 = large text / UI boundary.
const PAIRS: Pair[] = [
  { fg: "--foreground", bg: "--background", min: 4.5, label: "body text on page" },
  { fg: "--foreground", bg: "--card", min: 4.5, label: "body text on card" },
  { fg: "--foreground", bg: "--surface-muted", min: 4.5, label: "text on muted surface" },
  { fg: "--muted-foreground", bg: "--background", min: 4.5, label: "muted text on page" },
  { fg: "--muted-foreground", bg: "--card", min: 4.5, label: "muted text on card" },
  { fg: "--primary-foreground", bg: "--primary", min: 4.5, label: "primary button label" },
  { fg: "--secondary-foreground", bg: "--secondary", min: 4.5, label: "secondary button label" },
  { fg: "--secondary-text", bg: "--card", min: 4.5, label: "turquoise text on card" },
  { fg: "--secondary-text", bg: "--background", min: 4.5, label: "turquoise text on page" },
  { fg: "--success-foreground", bg: "--success", min: 4.5, label: "success badge label" },
  { fg: "--warning-foreground", bg: "--warning", min: 4.5, label: "warning badge label" },
  { fg: "--danger-foreground", bg: "--danger", min: 4.5, label: "danger badge label" },
  { fg: "--warning-strong", bg: "--card", min: 4.5, label: "warning text on card" },
  { fg: "--warning-strong", bg: "--background", min: 4.5, label: "warning text on page" },
  { fg: "--ring", bg: "--background", min: 3, label: "focus ring on page" },
];

const THEMES: Array<{ name: string; selector: string }> = [
  { name: "light", selector: '[data-app="authed"]' },
  { name: "dark", selector: '.dark [data-app="authed"]' },
];

describe("authed palette — WCAG AA contrast", () => {
  for (const theme of THEMES) {
    const vars = parseBlock(theme.selector);

    it(`[${theme.name}] every critical pairing meets its minimum ratio`, () => {
      const failures: string[] = [];
      for (const p of PAIRS) {
        const fg = vars[p.fg];
        const bg = vars[p.bg];
        if (!fg || !bg) {
          failures.push(`${p.label}: missing token ${!fg ? p.fg : p.bg} in ${theme.name}`);
          continue;
        }
        const ratio = contrast(fg, bg);
        if (ratio < p.min) {
          failures.push(
            `${p.label}: ${p.fg} (${fg}) on ${p.bg} (${bg}) = ${ratio.toFixed(2)}:1, need >= ${p.min}`,
          );
        }
      }
      if (failures.length > 0) {
        throw new Error(
          `WCAG AA failures in the ${theme.name} authed palette:\n  ${failures.join("\n  ")}`,
        );
      }
      expect(failures).toEqual([]);
    });
  }

  it("brand-* is remapped to red and accent-* to turquoise inside the authed scope", () => {
    const vars = parseBlock('[data-app="authed"]');
    // brand-500 should be the red primary, accent-500 the turquoise secondary.
    expect(vars["--color-brand-500"]).toBe("#d14638");
    expect(vars["--color-accent-500"]).toBe("#1ea896");
  });
});
