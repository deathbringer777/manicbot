/**
 * Pure tests for the "Open" URL resolution + availableFor label formatting
 * used by PluginDetailClient.
 *
 * Updated: plugins with a runtime now return `/plugin/<slug>` as openUrl.
 */

import { describe, it, expect } from "vitest";
import { listManifests, getPlugin } from "@plugins/index";
import { hasRuntime } from "~/components/plugins/runtimePanels";
import type { PluginManifest, PluginRole } from "@plugins/types";

function resolveOpenUrl(
  slug: string,
  manifest: PluginManifest,
  installed: boolean,
  enabled: boolean,
  role: PluginRole | null,
): string | null {
  if (!installed || !enabled) return null;
  // Plugins with a runtime get the dedicated open page.
  if (hasRuntime(slug)) {
    return `/plugin/${slug}`;
  }
  if (manifest.capabilities.settingsPanel) {
    return `/settings?section=${manifest.capabilities.settingsPanel.sectionKey}`;
  }
  const navContribs = manifest.capabilities.nav ?? [];
  const hit = navContribs.find((c) => role && c.roles.includes(role as typeof c.roles[number]));
  return hit?.href ?? null;
}

describe("resolveOpenUrl", () => {
  const plainManifest = getPlugin("ai-abuse-monitor")!.manifest;

  it("returns null when not installed", () => {
    expect(resolveOpenUrl("ai-abuse-monitor", plainManifest, false, false, "system_admin")).toBeNull();
  });

  it("returns null when installed but not enabled", () => {
    expect(resolveOpenUrl("ai-abuse-monitor", plainManifest, true, false, "system_admin")).toBeNull();
  });

  it("returns null for a plugin with no runtime, no settingsPanel + no nav", () => {
    expect(resolveOpenUrl("ai-abuse-monitor", plainManifest, true, true, "system_admin")).toBeNull();
  });

  it("returns /plugin/<slug> when plugin has a runtime", () => {
    const runtimeSlug = "quick-notes";
    const m = getPlugin(runtimeSlug)!.manifest;
    expect(resolveOpenUrl(runtimeSlug, m, true, true, "system_admin")).toBe(`/plugin/${runtimeSlug}`);
  });

  it("returns settings URL when plugin has settingsPanel but no runtime", () => {
    const m: PluginManifest = {
      ...plainManifest,
      slug: "ai-abuse-monitor", // ensure no runtime override
      capabilities: { settingsPanel: { sectionKey: "plugin:x", componentId: "x.Panel" } },
    };
    // ai-abuse-monitor has no runtime, so settingsPanel takes precedence
    expect(resolveOpenUrl("ai-abuse-monitor", m, true, true, "system_admin")).toBe("/settings?section=plugin:x");
  });

  it("returns nav[0].href when only nav contributions exist and role matches", () => {
    const m: PluginManifest = {
      ...plainManifest,
      capabilities: {
        nav: [
          { id: "plugin.x", href: "/plugins/x/settings", iconName: "Bell", labelKey: "self.name", roles: ["tenant_owner"] },
        ],
      },
    };
    expect(resolveOpenUrl("ai-abuse-monitor", m, true, true, "tenant_owner")).toBe("/plugins/x/settings");
  });

  it("nav match respects role filter", () => {
    const m: PluginManifest = {
      ...plainManifest,
      capabilities: {
        nav: [
          { id: "plugin.x", href: "/plugins/x/settings", iconName: "Bell", labelKey: "self.name", roles: ["master"] },
        ],
      },
    };
    expect(resolveOpenUrl("ai-abuse-monitor", m, true, true, "tenant_owner")).toBeNull();
  });
});

describe("availableFor role labels", () => {
  const LABELS: Record<string, string> = {
    system_admin: "Platform admin",
    tenant_owner: "Salon owner",
    master: "Master",
    support: "Support",
    technical_support: "Tech support",
    tenant_manager: "Salon manager",
  };

  it("every seed plugin's availableForRoles has a known label", () => {
    for (const m of listManifests()) {
      for (const role of m.availableForRoles) {
        expect(LABELS[role]).toBeTruthy();
      }
    }
  });
});
