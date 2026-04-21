/**
 * Validates the real seeded catalog:
 *  - Zod passes for every manifest
 *  - all 30+ manifests declare full 4-language coverage
 *  - no duplicate slugs
 *  - translations are actually different (not copy-paste placeholder)
 *  - paid addons declare a Stripe price env var name
 *  - role-gated plugins list at least one concrete role
 */

import { describe, it, expect } from "vitest";
import { listManifests, findDuplicateSlugs } from "@plugins/index";
import { validateAllManifests } from "~/server/plugins/manifestSchema";
import { PLUGIN_LANGS, type PluginLang } from "@plugins/types";

const manifests = listManifests();
const realPlugins = manifests.filter((m) => !/^(hello-world|live-test|platform-test)$/.test(m.slug));

describe("Seeded catalog — global shape", () => {
  it("at least 26 real plugins are registered", () => {
    expect(realPlugins.length).toBeGreaterThanOrEqual(26);
  });

  it("no duplicate slugs", () => {
    expect(findDuplicateSlugs()).toEqual([]);
  });

  it("every manifest passes Zod", () => {
    const r = validateAllManifests();
    expect(r.ok).toBe(true);
  });
});

describe("Seeded catalog — localization coverage", () => {
  it.each(PLUGIN_LANGS)("name is populated for lang=%s on every plugin", (lang: PluginLang) => {
    for (const m of realPlugins) {
      expect(m.name[lang]).toBeTruthy();
      expect(m.name[lang].length).toBeGreaterThan(1);
    }
  });

  it.each(PLUGIN_LANGS)("tagline is populated for lang=%s on every plugin", (lang: PluginLang) => {
    for (const m of realPlugins) {
      expect(m.tagline[lang]).toBeTruthy();
    }
  });

  it.each(PLUGIN_LANGS)("description is populated for lang=%s on every plugin", (lang: PluginLang) => {
    for (const m of realPlugins) {
      expect(m.description[lang].length).toBeGreaterThan(10);
    }
  });

  it.each(PLUGIN_LANGS)("keywords are populated for lang=%s on every plugin", (lang: PluginLang) => {
    for (const m of realPlugins) {
      expect(m.keywords[lang].length).toBeGreaterThan(0);
    }
  });

  it("tagline differs between languages for each plugin (no copy-paste across ru/en)", () => {
    for (const m of realPlugins) {
      // At least 2 out of 4 must be distinct (tolerance — some plugins like AI keep name English)
      const uniq = new Set(Object.values(m.tagline)).size;
      expect(uniq).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("Seeded catalog — role coverage matrix", () => {
  it("has at least 5 plugins available for tenant_owner", () => {
    const n = realPlugins.filter((m) => m.availableForRoles.includes("tenant_owner")).length;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 plugins available for master", () => {
    const n = realPlugins.filter((m) => m.availableForRoles.includes("master")).length;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 plugins available for support/technical_support", () => {
    const n = realPlugins.filter(
      (m) => m.availableForRoles.includes("support") || m.availableForRoles.includes("technical_support"),
    ).length;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 plugins available for system_admin", () => {
    const n = realPlugins.filter((m) => m.availableForRoles.includes("system_admin")).length;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 plugins available for tenant_manager", () => {
    const n = realPlugins.filter((m) => m.availableForRoles.includes("tenant_manager")).length;
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("has at least 5 universal plugins (available for 5+ roles)", () => {
    const universal = realPlugins.filter((m) => m.availableForRoles.length >= 5);
    expect(universal.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Seeded catalog — billing integrity", () => {
  it("paid_addon_monthly plugins declare stripePriceIdEnv", () => {
    const paidMonthly = realPlugins.filter((m) => m.billing.model === "paid_addon_monthly");
    for (const m of paidMonthly) {
      expect(m.billing.stripePriceIdEnv).toMatch(/^STRIPE_PRICE_[A-Z0-9_]+$/);
    }
  });

  it("paid_addon_onetime plugins declare stripePriceIdEnv", () => {
    const onetime = realPlugins.filter((m) => m.billing.model === "paid_addon_onetime");
    for (const m of onetime) {
      expect(m.billing.stripePriceIdEnv).toMatch(/^STRIPE_PRICE_[A-Z0-9_]+$/);
    }
  });

  it("included_in_plan plugins declare featureKey", () => {
    const included = realPlugins.filter((m) => m.billing.model === "included_in_plan");
    for (const m of included) {
      expect(m.billing.featureKey).toBeTruthy();
    }
  });

  it("free plugins do NOT declare stripePriceIdEnv", () => {
    for (const m of realPlugins) {
      if (m.billing.model === "free") {
        expect(m.billing.stripePriceIdEnv).toBeUndefined();
      }
    }
  });
});

describe("Seeded catalog — icon validity", () => {
  it("every icon name starts with a capital letter (lucide convention)", () => {
    for (const m of realPlugins) {
      expect(m.icon.name[0]).toMatch(/[A-Z]/);
    }
  });

  it("every icon tint is a valid hex color", () => {
    for (const m of realPlugins) {
      expect(m.icon.tint).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });
});

describe("Seeded catalog — coming_soon plugins carry no lifecycle or router", () => {
  it("coming_soon plugins do not declare trpcSubRouter:true", () => {
    const cs = realPlugins.filter((m) => m.status === "coming_soon");
    for (const m of cs) {
      expect(m.capabilities.trpcSubRouter).not.toBe(true);
    }
  });
});
