/**
 * End-to-end regression for the "Plugins" sidebar entry across roles.
 *
 * Asserts the static nav config in NAV_ITEMS exposes a Plugins link for every
 * role that should see it, with the right group (god → platform; others flat)
 * and without `requiresPersonalTenant`.
 */

import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "~/lib/nav/navConfig";

describe("NAV_ITEMS — Plugins visibility per role", () => {
  const plugins = NAV_ITEMS.filter((i) => i.labelKey === "Plugins");

  it("exposes at least one Plugins entry", () => {
    expect(plugins.length).toBeGreaterThanOrEqual(4);
  });

  it("Plugins entry exists for system_admin under the platform group", () => {
    const god = plugins.find((i) => i.roles.includes("system_admin"));
    expect(god).toBeTruthy();
    expect(god?.group).toBe("platform");
    expect(god?.href).toBe("/plugins");
  });

  it("Plugins entry exists for tenant_owner", () => {
    const salon = plugins.find((i) => i.roles.includes("tenant_owner"));
    expect(salon).toBeTruthy();
    expect(salon?.href).toBe("/plugins");
    expect(salon?.requiresPersonalTenant).toBeFalsy();
  });

  it("Plugins entry exists for master", () => {
    const master = plugins.find((i) => i.roles.includes("master"));
    expect(master).toBeTruthy();
    expect(master?.href).toBe("/plugins");
    expect(master?.requiresPersonalTenant).toBeFalsy();
  });

  it("Plugins entry exists for support + technical_support", () => {
    const support = plugins.find((i) => i.roles.includes("support") && i.roles.includes("technical_support"));
    expect(support).toBeTruthy();
    expect(support?.href).toBe("/plugins");
  });

  it("every Plugins href points to /plugins", () => {
    for (const p of plugins) expect(p.href).toBe("/plugins");
  });

  it("god-mode entry lives in group='platform' (not 'management')", () => {
    const god = plugins.find((i) => i.roles.length === 1 && i.roles[0] === "system_admin");
    expect(god?.group).toBe("platform");
  });

  it("no Plugins entry is marked requiresPersonalTenant", () => {
    for (const p of plugins) {
      expect(p.requiresPersonalTenant).toBeFalsy();
    }
  });
});

describe("NAV_LABELS — Plugins translated in all 4 languages", () => {
  // Dynamic import to avoid circular in test
  it("has Plugins key present in every language bundle", async () => {
    const { NAV_LABELS } = await import("~/lib/nav/navLabels");
    for (const lang of ["ru", "ua", "en", "pl"] as const) {
      expect(NAV_LABELS[lang]?.["Plugins"]).toBeTruthy();
    }
  });

  it("Plugins label differs between ru and en (not placeholder)", async () => {
    const { NAV_LABELS } = await import("~/lib/nav/navLabels");
    expect(NAV_LABELS.ru?.["Plugins"]).toBe("Плагины");
    expect(NAV_LABELS.ua?.["Plugins"]).toBe("Плагіни");
    expect(NAV_LABELS.en?.["Plugins"]).toBe("Plugins");
    expect(NAV_LABELS.pl?.["Plugins"]).toBe("Wtyczki");
  });
});
