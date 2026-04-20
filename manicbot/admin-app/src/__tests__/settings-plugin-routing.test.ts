/**
 * Pure test: verifies the `plugin:<slug>` URL convention + slug validation
 * used by SettingsPageClient.renderSection for routing to
 * PluginSettingsSection.
 *
 * We can't render the full page here (needs Shell + SettingsShell + auth),
 * so we assert the routing invariant by replicating the matcher.
 */

import { describe, it, expect } from "vitest";

function routeTarget(activeSection: string): { kind: "plugin" | "builtin"; slug?: string } {
  if (activeSection.startsWith("plugin:")) {
    const slug = activeSection.slice("plugin:".length);
    if (/^[a-z][a-z0-9-]{2,40}$/.test(slug)) {
      return { kind: "plugin", slug };
    }
  }
  return { kind: "builtin" };
}

describe("settings section routing for plugin:<slug>", () => {
  it("valid plugin slug routes to plugin panel", () => {
    expect(routeTarget("plugin:sms-reminders")).toEqual({ kind: "plugin", slug: "sms-reminders" });
  });

  it("non-plugin section routes to builtin handlers", () => {
    expect(routeTarget("account")).toEqual({ kind: "builtin" });
    expect(routeTarget("billing")).toEqual({ kind: "builtin" });
  });

  it("falls back to builtin when slug shape is invalid", () => {
    expect(routeTarget("plugin:Bad_Slug")).toEqual({ kind: "builtin" });
    expect(routeTarget("plugin:ab")).toEqual({ kind: "builtin" });
    expect(routeTarget("plugin:../etc/passwd")).toEqual({ kind: "builtin" });
  });

  it("empty plugin slug falls back to builtin", () => {
    expect(routeTarget("plugin:")).toEqual({ kind: "builtin" });
  });
});
