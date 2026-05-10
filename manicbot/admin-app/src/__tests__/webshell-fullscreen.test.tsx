/**
 * WebShell fullscreen + theme toggle — source-level regression guard.
 *
 * The full WebShell render path is too coupled to Next.js context (next/link,
 * NextAuth session, dynamic nav resolution) for a clean unit test. Instead
 * we lock in the *contract*: WebShell must expose both the theme and
 * fullscreen toggle buttons with stable testids and wire them to the
 * Fullscreen API. End-to-end confirmation lives in the post-deploy Chrome
 * MCP smoke test recorded in §13 of the comparison plan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(__dirname, "..", "components", "layout", "WebShell.tsx"),
  "utf8",
);

describe("WebShell — chrome contract (regression guard)", () => {
  it("declares the theme toggle with a stable testid", () => {
    expect(SRC).toMatch(/data-testid=["']webshell-theme-toggle["']/);
  });

  it("declares the fullscreen toggle with a stable testid", () => {
    expect(SRC).toMatch(/data-testid=["']webshell-fullscreen-toggle["']/);
  });

  it("calls document.documentElement.requestFullscreen when entering", () => {
    expect(SRC).toMatch(/document\.documentElement\.requestFullscreen\(\)/);
  });

  it("calls document.exitFullscreen when leaving", () => {
    expect(SRC).toMatch(/document\.exitFullscreen\(\)/);
  });

  it("subscribes to fullscreenchange so the icon flips on Escape", () => {
    expect(SRC).toMatch(/addEventListener\(["']fullscreenchange["']/);
    expect(SRC).toMatch(/removeEventListener\(["']fullscreenchange["']/);
  });

  it("hides the fullscreen toggle on touch breakpoints (no Escape route)", () => {
    // The button has the `hidden lg:flex` class so it only appears on desktop.
    expect(SRC).toMatch(/hidden\s+lg:flex[^"]*/);
  });

  it("persists theme to localStorage under the canonical key", () => {
    expect(SRC).toMatch(/localStorage\.setItem\(["']manicbot_web_theme["']/);
  });

  it("toggles the .dark class on documentElement (Tailwind dark mode)", () => {
    expect(SRC).toMatch(/document\.documentElement\.classList\.toggle\(["']dark["']/);
  });

  it("uses Maximize2 / Minimize2 lucide icons (not random ones)", () => {
    expect(SRC).toMatch(/Maximize2/);
    expect(SRC).toMatch(/Minimize2/);
  });

  it("applies aria-pressed for accessibility", () => {
    expect(SRC).toMatch(/aria-pressed=\{isFullscreen\}/);
  });
});
