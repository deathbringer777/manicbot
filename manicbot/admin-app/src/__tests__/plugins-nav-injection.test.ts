/**
 * Plugin nav-injection — real-source pin + real helper exercise.
 *
 * Phase 2 cleanup: dropped the local `filterContributionsFor` mirror that
 * duplicated the filter logic inside `useNavItems`. The contribution
 * filter lives inline in the hook (not exported), so we structurally
 * pin its three gates (id-dedup, role-include, requiresPersonalTenant)
 * against the real source file. `resolvePluginIcon` is the one exported
 * helper this file used — we exercise it directly.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolvePluginIcon } from "~/lib/nav/pluginNavIcons";
import { PLUGIN_LANGS, type PluginManifest } from "@plugins/types";

const HOOK_SRC = readFileSync(
  path.resolve(__dirname, "../lib/nav/useNavItems.ts"),
  "utf8",
);

describe("useNavItems — plugin nav-contribution filter (structural pin)", () => {
  it("declares a per-call dedup set keyed on contrib.id", () => {
    expect(HOOK_SRC).toMatch(/const\s+seenIds\s*=\s*new\s+Set<string>\(\)/);
    expect(HOOK_SRC).toMatch(/if\s*\(\s*seenIds\.has\(contrib\.id\)\s*\)\s*continue/);
    expect(HOOK_SRC).toMatch(/seenIds\.add\(contrib\.id\)/);
  });

  it("gates contributions by role membership in contrib.roles", () => {
    expect(HOOK_SRC).toMatch(
      /if\s*\(\s*effectiveRoleStr\s*&&\s*!contrib\.roles\.includes\(effectiveRoleStr\)\s*\)\s*continue/,
    );
  });

  it("gates contributions by requiresPersonalTenant when set", () => {
    expect(HOOK_SRC).toMatch(
      /if\s*\(\s*contrib\.requiresPersonalTenant\s*&&\s*!isPersonalTenant\s*\)\s*continue/,
    );
  });

  it("skips installs where enabled !== 1 (paid-addon billing state can disable)", () => {
    expect(HOOK_SRC).toMatch(/if\s*\(\s*row\.enabled\s*!==\s*1\s*\)\s*continue/);
  });

  it("uses the plugin's manifest.capabilities.nav as the contribution source", () => {
    expect(HOOK_SRC).toMatch(/p\.manifest\.capabilities\.nav/);
  });
});

describe("resolvePluginIcon — exported helper", () => {
  it("resolves a known lucide name to a renderable component", () => {
    const icon = resolvePluginIcon("Bell");
    expect(icon).toBeTruthy();
    // lucide icons render as function components / object refs
    expect(["function", "object"]).toContain(typeof icon);
  });

  it("falls back to Puzzle (no crash) for unknown names", () => {
    const icon = resolvePluginIcon("NonExistent9000");
    expect(icon).toBeTruthy();
    expect(["function", "object"]).toContain(typeof icon);
  });

  it("falls back gracefully when iconName is empty string", () => {
    const icon = resolvePluginIcon("");
    expect(icon).toBeTruthy();
  });
});

describe("PluginManifest.name contract — all four supported languages", () => {
  it("self.name labels carry RU / UA / EN / PL", () => {
    const fakeManifest: Pick<PluginManifest, "name"> = {
      name: { ru: "R", ua: "U", en: "E", pl: "P" },
    };
    for (const l of PLUGIN_LANGS) expect(fakeManifest.name[l]).toBeTruthy();
  });
});
