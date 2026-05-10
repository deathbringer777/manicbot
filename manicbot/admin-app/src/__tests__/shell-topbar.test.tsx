/**
 * Shell DashboardTopBar — source-level regression guard.
 *
 * Shell renders a sticky top bar for non-WebShell paths (Telegram Mini App
 * embedded view, auth-gated public-only pages, future tier-2 dashboards).
 * Inside WebShell context Shell short-circuits to children — the WebShell
 * variant is covered by webshell-fullscreen.test.tsx.
 *
 * This test pins the contract: theme + fullscreen toggles exist, point at
 * the right APIs, and the Fullscreen API integration follows the same
 * pattern as WebShell so a future refactor can extract them into a shared
 * primitive without surprises.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(__dirname, "..", "components", "layout", "Shell.tsx"),
  "utf8",
);

describe("Shell — DashboardTopBar contract (regression guard)", () => {
  it("declares the dashboard top bar testid", () => {
    expect(SRC).toMatch(/data-testid=["']dashboard-top-bar["']/);
  });

  it("declares the theme toggle testid", () => {
    expect(SRC).toMatch(/data-testid=["']topbar-theme-toggle["']/);
  });

  it("declares the fullscreen toggle testid", () => {
    expect(SRC).toMatch(/data-testid=["']topbar-fullscreen-toggle["']/);
  });

  it("uses Sun + Moon lucide icons for theme indicator", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\bSun\b/);
    expect(SRC).toMatch(/import\s*\{[^}]*\bMoon\b/);
  });

  it("uses Maximize2 + Minimize2 lucide icons for fullscreen indicator", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*\bMaximize2\b/);
    expect(SRC).toMatch(/import\s*\{[^}]*\bMinimize2\b/);
  });

  it("calls requestFullscreen + exitFullscreen on document.documentElement / document", () => {
    expect(SRC).toMatch(/document\.documentElement\.requestFullscreen\(\)/);
    expect(SRC).toMatch(/document\.exitFullscreen\(\)/);
  });

  it("subscribes to fullscreenchange and cleans up on unmount", () => {
    expect(SRC).toMatch(/addEventListener\(["']fullscreenchange["']/);
    expect(SRC).toMatch(/removeEventListener\(["']fullscreenchange["']/);
  });

  it("uses the canonical localStorage key shared with PublicThemeProvider/WebShell", () => {
    expect(SRC).toMatch(/manicbot_web_theme/);
  });

  it("top bar is desktop-only (hidden md:flex)", () => {
    // Mobile already has its own header in Shell, so the desktop top bar
    // is gated to md+ breakpoints to avoid a duplicate header on phones.
    // Match the testid attribute and the hidden md:flex class within the
    // same opening tag (data-testid comes first, className follows).
    expect(SRC).toMatch(/data-testid=["']dashboard-top-bar["'][\s\S]*?hidden\s+md:flex/);
  });

  it("the top bar is sticky (sticky top-0)", () => {
    expect(SRC).toMatch(/sticky\s+top-0/);
  });

  it("uses i18n keys topbar.* (not hardcoded strings)", () => {
    expect(SRC).toMatch(/t\(\s*["']topbar\.(?:darkMode|lightMode|enterFullscreen|exitFullscreen)["']/);
  });

  it("DashboardTopBar is invoked from the Shell main content area", () => {
    expect(SRC).toMatch(/<DashboardTopBar\s+title=\{displayTitle\}/);
  });
});
