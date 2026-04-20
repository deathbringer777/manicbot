/**
 * Fixture plugin — used by the test suite to exercise the registry,
 * tRPC router, and lifecycle paths end-to-end. Hidden from the production
 * catalog by the leading underscore convention + status:"coming_soon" until
 * real seed plugins land in Sprint 5.
 */

import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "hello-world",
  version: "0.1.0",
  vendor: "manicbot",
  category: "productivity",
  status: "coming_soon",
  scope: "both",
  icon: { name: "Sparkles", tint: "#8b5cf6" },
  name: {
    ru: "Hello World",
    ua: "Hello World",
    en: "Hello World",
    pl: "Hello World",
  },
  tagline: {
    ru: "Тестовый плагин для проверки pipeline",
    ua: "Тестовий плагін для перевірки pipeline",
    en: "Fixture plugin to exercise the plugin pipeline",
    pl: "Wtyczka testowa do weryfikacji pipeline",
  },
  description: {
    ru: "Этот плагин ничего не делает — он используется автотестами.",
    ua: "Цей плагін нічого не робить — використовується автотестами.",
    en: "This plugin does nothing — used by the automated test suite.",
    pl: "Ta wtyczka nic nie robi — używana przez testy automatyczne.",
  },
  keywords: {
    ru: ["тест", "fixture", "hello"],
    ua: ["тест", "fixture", "hello"],
    en: ["test", "fixture", "hello"],
    pl: ["test", "fixture", "hello"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
