/**
 * Test fixture plugin: status="live", scope="tenant", minPlan="pro",
 * billing="free". Used to exercise happy-path install/uninstall flows.
 */

import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "live-test",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "tenant",
  icon: { name: "Rocket", tint: "#10b981" },
  name: { ru: "Live Test", ua: "Live Test", en: "Live Test", pl: "Live Test" },
  tagline: {
    ru: "Fixture для позитивных тестов",
    ua: "Fixture для позитивних тестів",
    en: "Fixture for happy-path tests",
    pl: "Fixture do testów pozytywnych",
  },
  description: {
    ru: "Используется только автотестами.",
    ua: "Використовується лише автотестами.",
    en: "Used only by the automated test suite.",
    pl: "Używane tylko przez testy automatyczne.",
  },
  keywords: {
    ru: ["live", "test"],
    ua: ["live", "test"],
    en: ["live", "test"],
    pl: ["live", "test"],
  },
  availableForRoles: ["tenant_owner", "system_admin"],
  minPlan: "pro",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
