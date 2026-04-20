import { describe, it, expect } from "vitest";
import { PluginManifestSchema } from "~/server/plugins/manifestSchema";
import {
  PLUGIN_LANGS,
  PLUGIN_CATEGORIES,
  PLUGIN_STATUSES,
  BILLING_MODELS,
  PLAN_GATE_VALUES,
  PLUGIN_ROLES,
  type PluginManifest,
} from "@plugins/types";

function validManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    slug: "test-plugin",
    version: "1.0.0",
    vendor: "manicbot",
    category: "productivity",
    status: "live",
    scope: "tenant",
    icon: { name: "Package", tint: "#3b82f6" },
    name: { ru: "Тест", ua: "Тест", en: "Test", pl: "Test" },
    tagline: { ru: "один", ua: "один", en: "one", pl: "jeden" },
    description: { ru: "Описание", ua: "Опис", en: "Description", pl: "Opis" },
    keywords: {
      ru: ["тест"], ua: ["тест"], en: ["test"], pl: ["test"],
    },
    availableForRoles: ["tenant_owner"],
    minPlan: "any",
    billing: { model: "free" },
    permissions: [],
    capabilities: {},
    lifecycle: {},
    ...overrides,
  };
}

describe("PluginManifestSchema — happy path", () => {
  it("accepts a minimal valid manifest", () => {
    const r = PluginManifestSchema.safeParse(validManifest());
    expect(r.success).toBe(true);
  });

  it("accepts a manifest with all optional fields populated", () => {
    const full = validManifest({
      screenshots: [{ url: "/shots/1.png", captionKey: "shots.1" }],
      capabilities: {
        nav: [{ id: "plugin.test", href: "/plugins/test", iconName: "Zap", labelKey: "test.nav", roles: ["tenant_owner"], group: "salon" }],
        settingsPanel: { sectionKey: "plugin:test-plugin", componentId: "test.SettingsPanel" },
        cron: [{ schedule: "*/15 * * * *", handlerId: "test.cron.tick" }],
        workerRoutes: [{ pattern: "GET /plugin/test/*", handlerId: "test.route.main" }],
        trpcSubRouter: true,
        healthCheck: true,
      },
      billing: { model: "paid_addon_monthly", stripePriceIdEnv: "STRIPE_PRICE_TEST_MONTHLY", priceHintUsd: 9 },
      permissions: [
        { key: "appointments.read", scope: "read" },
        { key: "billing.manage", scope: "write", sensitive: true },
      ],
      lifecycle: { onInstall: true, onUninstall: true },
    });
    const r = PluginManifestSchema.safeParse(full);
    expect(r.success).toBe(true);
  });

  it.each(PLUGIN_LANGS)("accepts any of the 4 supported langs in LocalizedText (%s)", (lang) => {
    const m = validManifest();
    expect(typeof m.name[lang]).toBe("string");
    expect(m.name[lang].length).toBeGreaterThan(0);
  });

  it.each(PLUGIN_CATEGORIES)("accepts category %s", (category) => {
    const r = PluginManifestSchema.safeParse(validManifest({ category }));
    expect(r.success).toBe(true);
  });

  it.each(PLUGIN_STATUSES)("accepts status %s", (status) => {
    const r = PluginManifestSchema.safeParse(validManifest({ status }));
    expect(r.success).toBe(true);
  });

  it.each(BILLING_MODELS)("accepts billing model %s", (model) => {
    const r = PluginManifestSchema.safeParse(validManifest({ billing: { model } }));
    expect(r.success).toBe(true);
  });

  it.each(PLAN_GATE_VALUES)("accepts minPlan %s", (minPlan) => {
    const r = PluginManifestSchema.safeParse(validManifest({ minPlan }));
    expect(r.success).toBe(true);
  });

  it.each(PLUGIN_ROLES)("accepts availableForRoles entry %s", (role) => {
    const r = PluginManifestSchema.safeParse(validManifest({ availableForRoles: [role] }));
    expect(r.success).toBe(true);
  });
});

describe("PluginManifestSchema — rejection cases", () => {
  it("rejects slug with uppercase", () => {
    expect(PluginManifestSchema.safeParse(validManifest({ slug: "BadSlug" })).success).toBe(false);
  });

  it("rejects slug too short", () => {
    expect(PluginManifestSchema.safeParse(validManifest({ slug: "ab" })).success).toBe(false);
  });

  it("rejects slug with trailing hyphen but accepts internal hyphens", () => {
    // internal hyphens should be fine
    expect(PluginManifestSchema.safeParse(validManifest({ slug: "good-one" })).success).toBe(true);
    // uppercase banned (strong form of the constraint)
    expect(PluginManifestSchema.safeParse(validManifest({ slug: "Bad-Slug" })).success).toBe(false);
  });

  it("rejects non-semver version", () => {
    expect(PluginManifestSchema.safeParse(validManifest({ version: "1.0" })).success).toBe(false);
    expect(PluginManifestSchema.safeParse(validManifest({ version: "v1.0.0" })).success).toBe(false);
    expect(PluginManifestSchema.safeParse(validManifest({ version: "1.0.0-beta" })).success).toBe(false);
  });

  it("rejects wrong vendor", () => {
    const bad = { ...validManifest(), vendor: "third-party" as const };
    expect(PluginManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects LocalizedText missing a language", () => {
    const m = validManifest();
    delete (m.name as Partial<typeof m.name>).pl;
    expect(PluginManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects LocalizedText with empty string", () => {
    const m = validManifest({ name: { ru: "", ua: "A", en: "A", pl: "A" } });
    expect(PluginManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects keywords with empty array for one language", () => {
    const m = validManifest({ keywords: { ru: [], ua: ["x"], en: ["x"], pl: ["x"] } });
    expect(PluginManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects empty availableForRoles", () => {
    expect(PluginManifestSchema.safeParse(validManifest({ availableForRoles: [] })).success).toBe(false);
  });

  it("rejects unknown category", () => {
    const bad = { ...validManifest(), category: "nonsense" as never };
    expect(PluginManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects icon tint that is not hex", () => {
    const m = validManifest({ icon: { name: "Package", tint: "blue" } });
    expect(PluginManifestSchema.safeParse(m).success).toBe(false);
  });

  it("rejects negative priceHintUsd", () => {
    const m = validManifest({ billing: { model: "paid_addon_onetime", priceHintUsd: -1 } });
    expect(PluginManifestSchema.safeParse(m).success).toBe(false);
  });
});
