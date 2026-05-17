/**
 * WebShell header — background palette pin.
 *
 * Bug history: the topbar carried `bg-white dark:bg-slate-900/80` while the
 * sidebar and workspace both ran on `bg-[#fafaf7]` (cream) in light mode and
 * `bg-slate-900` in dark. Result: a visible brighter strip across the top of
 * every dashboard page, sitting between the cream sidebar (left) and cream
 * workspace (right). The user flagged it as "разные цвета".
 *
 * Fix: header background syncs to the workspace palette
 * (`bg-[#fafaf7] dark:bg-slate-900`). The sticky `border-b` keeps the
 * visual separation between header and content without relying on a
 * brightness jump.
 *
 * This test pins the contract by string-matching the header className.
 * A future refactor that re-introduces `bg-white` (or any other
 * non-workspace shade) on the data-tour="web-header" element fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC = readFileSync(
  path.resolve(__dirname, "..", "components", "layout", "WebShell.tsx"),
  "utf8",
);

describe("WebShell header — palette parity with workspace", () => {
  it("header background uses #fafaf7 in light mode", () => {
    const idx = SRC.indexOf('data-tour="web-header"');
    expect(idx).toBeGreaterThan(0);
    const tail = SRC.slice(idx, idx + 600);
    // Look for the className that follows the anchor.
    const m = tail.match(/className="([^"]+)"/);
    expect(m).toBeTruthy();
    const cls = m![1]!;
    expect(cls).toMatch(/bg-\[#fafaf7\]/);
    // Hard NO on the old pure-white shade. `bg-white/N` opacity utilities
    // are fine (used for sub-elements like buttons), but the literal
    // `bg-white` on the header itself is the regression we're guarding.
    expect(cls).not.toMatch(/\bbg-white\b/);
  });

  it("header background uses slate-900 in dark mode (no /N opacity drift)", () => {
    const idx = SRC.indexOf('data-tour="web-header"');
    const tail = SRC.slice(idx, idx + 600);
    const m = tail.match(/className="([^"]+)"/);
    const cls = m![1]!;
    // Sidebar uses dark:bg-slate-900/70, workspace root uses dark:bg-slate-900.
    // We sync header to the root so there's no opacity-driven brightness jump.
    expect(cls).toMatch(/dark:bg-slate-900(?!\/)/);
  });

  it("workspace root uses #fafaf7 — the value we sync the header to", () => {
    // Anchor on the outermost flex container of WebShell.
    expect(SRC).toMatch(/flex h-screen w-full overflow-hidden bg-\[#fafaf7\]/);
  });

  it("sidebar uses #fafaf7 — palette is consistent across the three surfaces", () => {
    // The desktop sidebar aside element carries the cream background.
    expect(SRC).toMatch(/border-r [^"]*bg-\[#fafaf7\]/);
  });
});
