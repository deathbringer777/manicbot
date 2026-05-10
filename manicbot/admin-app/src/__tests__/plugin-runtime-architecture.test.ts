/**
 * Architecture-level invariants for plugin runtime components.
 *
 * These tests are NOT about behavior — they enforce contracts that prevent the
 * kind of drift we hit before: a runtime hand-rolling its own logo SVG that
 * looks nothing like the catalog card. The tests fail at the file-content
 * level so a regression cannot ship even if the runtime "renders fine".
 *
 * Invariants:
 *   1. Every slug registered in `runtimePanels.RUNTIME_LOADERS` resolves to a
 *      manifest in the plugin registry.
 *   2. Every `*Runtime.tsx` file (except `BackgroundRuntimePlaceholder.tsx`,
 *      which is the explicit "no UI" fallback) imports `PluginRuntimeShell`.
 *   3. No `*Runtime.tsx` file ships an inline plugin LOGO. Detection runs on
 *      two signatures Google Calendar's hand-rolled logo had: a 200x200
 *      viewBox SVG, OR an SVG that includes Google's brand-red hex `#ea4335`
 *      (the runtime should rely on `PluginIcon` instead).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { listPlugins, findDuplicateSlugs } from "@plugins/index";
import { listRuntimeSlugs } from "~/components/plugins/runtimePanels";

const RUNTIMES_DIR = join(
  fileURLToPath(new URL("../components/plugins/runtimes/", import.meta.url))
);

const PLACEHOLDER_FILE = "BackgroundRuntimePlaceholder.tsx";

function readRuntimeFiles(): { name: string; content: string }[] {
  return readdirSync(RUNTIMES_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({
      name: f,
      content: readFileSync(join(RUNTIMES_DIR, f), "utf8"),
    }));
}

describe("plugin runtime architecture", () => {
  it("every registered runtime slug has a matching manifest in the registry", () => {
    const manifestSlugs = new Set(listPlugins().map((p) => p.manifest.slug));
    const orphans = listRuntimeSlugs().filter((slug) => !manifestSlugs.has(slug));
    expect(orphans).toEqual([]);
  });

  it("every *Runtime.tsx imports PluginRuntimeShell (placeholder excepted)", () => {
    const offenders: string[] = [];
    for (const file of readRuntimeFiles()) {
      if (file.name === PLACEHOLDER_FILE) continue;
      if (!file.content.includes("PluginRuntimeShell")) {
        offenders.push(file.name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no runtime ships an inline plugin LOGO (Google Calendar regression guard)", () => {
    const offenders: { file: string; reason: string }[] = [];
    for (const file of readRuntimeFiles()) {
      if (file.name === PLACEHOLDER_FILE) continue;
      // Big-square 200x200 SVGs are the shape brand logos take. The G mark
      // inside the OAuth button uses 0 0 48 48, which is allowed.
      if (/viewBox=["']\s*0\s+0\s+200\s+200\s*["']/.test(file.content)) {
        offenders.push({ file: file.name, reason: "200x200 SVG (looks like a brand logo)" });
      }
      // Google's brand red. The runtime must not re-introduce the official
      // Google Calendar logo inline — it must come from PluginIcon.
      if (/#ea4335/i.test(file.content)) {
        // Allow it inside the small G-mark used in the OAuth button.
        // The G-mark uses the 48x48 viewBox; flag only when there's NO 48x48
        // SVG nearby (i.e. the colour appears inside a brand logo).
        const has48Svg = /viewBox=["']\s*0\s+0\s+48\s+48\s*["']/.test(file.content);
        if (!has48Svg) {
          offenders.push({ file: file.name, reason: "uses #ea4335 outside of a 48x48 G-mark" });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("manifest slugs are unique (no two plugins share the same slug)", () => {
    expect(findDuplicateSlugs()).toEqual([]);
  });

  it("listRuntimeSlugs returns at least the production-critical plugins", () => {
    const slugs = new Set(listRuntimeSlugs());
    // These three are the most user-visible runtimes today; if any of them
    // disappears from the loader map, surface the regression early.
    expect(slugs.has("google-calendar")).toBe(true);
    expect(slugs.has("task-board")).toBe(true);
    expect(slugs.has("quick-notes")).toBe(true);
  });

  it("runtime file names follow the *Runtime.tsx convention", () => {
    const offenders: string[] = [];
    for (const f of readdirSync(RUNTIMES_DIR)) {
      if (!f.endsWith(".tsx")) continue;
      if (f === PLACEHOLDER_FILE) continue;
      const stem = basename(f, ".tsx");
      if (!stem.endsWith("Runtime")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
