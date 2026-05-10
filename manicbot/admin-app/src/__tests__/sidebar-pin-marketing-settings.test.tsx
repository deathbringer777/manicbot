/**
 * Follow-up to #16/17/18 — pin position, marketing nav, settings width.
 *
 * 1. Marketing nav item exists for both system_admin (god.marketing) and
 *    tenant_owner (salon.marketing). Per-locale labels filled in.
 * 2. PinnedNavSection renders BELOW the nav groups (per user feedback:
 *    pinned plugins belong with Plugins, not as a top-of-sidebar section).
 * 3. Settings pages drop the max-w-7xl gutter so the section rail + body
 *    can use the full width next to the sidebar.
 *
 * Source-level guards because the live render path is too coupled to
 * Next.js context for a clean unit test (the dashboard tests in
 * webshell-fullscreen.test.tsx and shell-topbar.test.tsx use the same
 * pattern). End-to-end confirmation lives in the post-deploy Chrome MCP
 * smoke test recorded in §13 of the comparison plan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NAV_CONFIG_SRC = readFileSync(
  join(__dirname, "..", "lib", "nav", "navConfig.ts"),
  "utf8",
);

const NAV_LABELS_SRC = readFileSync(
  join(__dirname, "..", "lib", "nav", "navLabels.ts"),
  "utf8",
);

const WEBSHELL_SRC = readFileSync(
  join(__dirname, "..", "components", "layout", "WebShell.tsx"),
  "utf8",
);

describe("nav: marketing entry exists for both surfaces", () => {
  it("god.marketing is registered for system_admin", () => {
    expect(NAV_CONFIG_SRC).toMatch(/id:\s*["']god\.marketing["']/);
    // Tied to /marketing route and uses Megaphone icon
    expect(NAV_CONFIG_SRC).toMatch(
      /id:\s*["']god\.marketing["'][\s\S]*?href:\s*["']\/marketing["'][\s\S]*?Megaphone/,
    );
    // system_admin role gating
    expect(NAV_CONFIG_SRC).toMatch(
      /id:\s*["']god\.marketing["'][\s\S]*?roles:\s*\[\s*["']system_admin["']/,
    );
  });

  it("salon.marketing is registered for tenant_owner (hideable)", () => {
    expect(NAV_CONFIG_SRC).toMatch(/id:\s*["']salon\.marketing["']/);
    expect(NAV_CONFIG_SRC).toMatch(
      /id:\s*["']salon\.marketing["'][\s\S]*?roles:\s*\[\s*["']tenant_owner["']/,
    );
    // Hideable so users on plans without marketing can dim it.
    expect(NAV_CONFIG_SRC).toMatch(
      /id:\s*["']salon\.marketing["'][\s\S]*?hideable:\s*true/,
    );
  });

  it("imports the Megaphone icon from lucide-react", () => {
    expect(NAV_CONFIG_SRC).toMatch(/import\s*\{[^}]*\bMegaphone\b/);
  });

  it("Marketing nav label is translated into all four languages", () => {
    // ru / ua / en / pl — the file has 4 sections, all must contain the key.
    const matches = NAV_LABELS_SRC.match(/"Marketing":\s*"[^"]+"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
    // Russian/Ukrainian use Cyrillic «Маркетинг», en/pl keep the Latin form.
    expect(NAV_LABELS_SRC).toMatch(/"Marketing":\s*"Маркетинг"/);
    expect(NAV_LABELS_SRC).toMatch(/"Marketing":\s*"Marketing"/);
  });
});

describe("WebShell — pinned plugins live below the nav groups", () => {
  it("desktop sidebar renders PinnedNavSection AFTER the navGroups loop", () => {
    // The nav groups loop must appear before the PinnedNavSection in the
    // desktop sidebar block. Captures the first occurrence of each.
    const desktopNav = WEBSHELL_SRC.split("hidden lg:flex flex-col")[1] ?? "";
    const groupsIdx = desktopNav.indexOf("navGroups.map");
    const pinnedIdx = desktopNav.indexOf("<PinnedNavSection");
    expect(groupsIdx).toBeGreaterThan(-1);
    expect(pinnedIdx).toBeGreaterThan(-1);
    expect(pinnedIdx).toBeGreaterThan(groupsIdx);
  });

  it("mobile drawer renders PinnedNavSection AFTER the navGroups loop", () => {
    const mobileNav = WEBSHELL_SRC.split("Mobile Drawer")[1] ?? "";
    const groupsIdx = mobileNav.indexOf("navGroups.map");
    const pinnedIdx = mobileNav.indexOf("<PinnedNavSection");
    expect(groupsIdx).toBeGreaterThan(-1);
    expect(pinnedIdx).toBeGreaterThan(-1);
    expect(pinnedIdx).toBeGreaterThan(groupsIdx);
  });
});

describe("WebShell — Settings pages use the full content width", () => {
  it("content wrapper is pathname-aware (max-w-none on /settings)", () => {
    expect(WEBSHELL_SRC).toMatch(
      /pathname\.startsWith\(["']\/settings["']\)\s*\?\s*["']max-w-none["']\s*:\s*["']max-w-7xl["']/,
    );
  });

  it("the regular non-settings route keeps the existing max-w-7xl gutter", () => {
    // Make sure we did not accidentally drop max-w-7xl for everything.
    expect(WEBSHELL_SRC).toMatch(/max-w-7xl/);
  });
});
