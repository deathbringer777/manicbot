/**
 * Tenant data-viz literal lock — regression guard for the beige+red+turquoise
 * migration.
 *
 * The tenant dashboard's charts and calendar were migrated off hardcoded color
 * literals onto theme-aware CSS variables (var(--chart-*), var(--status-*),
 * var(--hatch), var(--drag-*), var(--trend-*)) defined in styles/globals.css,
 * plus the centralized channel colors in lib/theme/palette.ts. This test pins
 * that: the files below must contain ZERO raw color literals (`#rrggbb`,
 * `rgb()/rgba()`, `hsl()`), so a future edit can't silently reintroduce a
 * dark-only / off-palette color. Add new colors to globals.css (a token) or
 * lib/theme/palette.ts (a JS value), never inline here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

// Files fully migrated to tokens/palette — must stay literal-free.
const LOCKED_FILES = [
  "components/dashboard/OverviewChart.tsx",
  "components/dashboard/ReferralSignupCharts.tsx",
  "components/salon/AnalyticsTab.tsx",
  "components/calendar/MonthCalendar.tsx",
  "components/calendar/DragCreateLayer.tsx",
  "components/dashboards/CalendarLeftRail.tsx",
  "components/dashboards/SalonDayView.tsx",
  "components/dashboards/SalonWeekView.tsx",
  "components/ui/KpiCard.tsx",
  "components/dashboard-ui/StatCard.tsx",
];

/** Strip block and line comments so example IDs / docs don't false-positive. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

// 6-digit hex with a word boundary (so 11-digit chat-ids like #10968255038
// don't match), or rgb()/rgba()/hsl() immediately followed by a number.
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const FUNC_RE = /\b(?:rgba?|hsla?)\(\s*[\d.]/g;

interface Hit {
  line: number;
  text: string;
}

function scan(rel: string): Hit[] {
  const src = stripComments(readFileSync(join(ROOT, rel), "utf8"));
  const hits: Hit[] = [];
  src.split("\n").forEach((line, i) => {
    if (HEX_RE.test(line) || FUNC_RE.test(line)) {
      hits.push({ line: i + 1, text: line.trim().slice(0, 140) });
    }
    HEX_RE.lastIndex = 0;
    FUNC_RE.lastIndex = 0;
  });
  return hits;
}

describe("tenant data-viz — no raw color literals", () => {
  for (const rel of LOCKED_FILES) {
    it(`${rel} uses tokens/palette only (no #hex / rgb() / hsl())`, () => {
      const hits = scan(rel);
      if (hits.length > 0) {
        const report = hits.map((h) => `  L${h.line}  ${h.text}`).join("\n");
        throw new Error(
          `Raw color literal(s) found in ${rel}. Use a CSS token in ` +
            `globals.css (var(--...)) or a value in lib/theme/palette.ts instead.\n${report}`,
        );
      }
      expect(hits).toEqual([]);
    });
  }
});
