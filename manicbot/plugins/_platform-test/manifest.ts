/**
 * Test fixture: platform-scope plugin for testing system_admin install flow.
 */

import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "platform-test",
  version: "0.1.0",
  vendor: "manicbot",
  category: "operations",
  status: "live",
  scope: "platform",
  icon: { name: "Shield", tint: "#f59e0b" },
  name: { ru: "Platform Test", ua: "Platform Test", en: "Platform Test", pl: "Platform Test" },
  tagline: {
    ru: "Platform-only fixture",
    ua: "Platform-only fixture",
    en: "Platform-only fixture",
    pl: "Platform-only fixture",
  },
  description: {
    ru: "Fixture для тестов platform-уровня.",
    ua: "Fixture для тестів platform-рівня.",
    en: "Fixture for platform-scope tests.",
    pl: "Fixture do testów zakresu platform.",
  },
  keywords: { ru: ["platform"], ua: ["platform"], en: ["platform"], pl: ["platform"] },
  availableForRoles: ["system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
