/**
 * Pure tests for the "Open" URL resolution + availableFor label formatting
 * used by PluginDetailClient.
 */

import { describe, it, expect } from "vitest";
import { listManifests, getPlugin } from "@plugins/index";
import type { PluginManifest, PluginRole } from "@plugins/types";

function resolveOpenUrl(
  manifest: PluginManifest,
  installed: boolean,
  enabled: boolean,
  role: PluginRole | null,
): string | null {
  if (!installed || !enabled) return null;
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
    expect(resolveOpenUrl(plainManifest, false, false, "system_admin")).toBeNull();
  });

  it("returns null when installed but not enabled", () => {
    expect(resolveOpenUrl(plainManifest, true, false, "system_admin")).toBeNull();
  });

  it("returns null for a plugin with no settingsPanel + no nav", () => {
    expect(resolveOpenUrl(plainManifest, true, true, "system_admin")).toBeNull();
  });

  it("returns settings URL when plugin has settingsPanel", () => {
    const m: PluginManifest = {
      ...plainManifest,
      capabilities: { settingsPanel: { sectionKey: "plugin:x", componentId: "x.Panel" } },
    };
    expect(resolveOpenUrl(m, true, true, "system_admin")).toBe("/settings?section=plugin:x");
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
    expect(resolveOpenUrl(m, true, true, "tenant_owner")).toBe("/plugins/x/settings");
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
    expect(resolveOpenUrl(m, true, true, "tenant_owner")).toBeNull();
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
