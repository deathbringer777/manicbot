import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "platform-analytics-pro",
  version: "0.1.0",
  vendor: "manicbot",
  category: "analytics",
  status: "coming_soon",
  scope: "platform",
  icon: { name: "BarChart3", tint: "#0ea5e9" },
  name: {
    ru: "Platform Analytics Pro",
    ua: "Platform Analytics Pro",
    en: "Platform Analytics Pro",
    pl: "Platform Analytics Pro",
  },
  tagline: {
    ru: "Когорты, retention и воронки по всей платформе",
    ua: "Когорти, retention і воронки по всій платформі",
    en: "Cohorts, retention and funnels across the platform",
    pl: "Kohorty, retencja i lejki w całej platformie",
  },
  description: {
    ru: "Отчёты по удержанию салонов, конверсии trial → paid, воронкам онбординга и аномалиям активности.",
    ua: "Звіти по утриманню салонів, конверсії trial → paid, воронкам онбордингу і аномаліям активності.",
    en: "Salon retention reports, trial→paid conversion funnels, onboarding bottlenecks and activity anomalies.",
    pl: "Raporty retencji salonów, konwersja trial→paid, lejki onboardingu i anomalie aktywności.",
  },
  keywords: {
    ru: ["аналитика", "когорты", "retention", "воронка", "метрики"],
    ua: ["аналітика", "когорти", "retention", "вирва", "метрики"],
    en: ["analytics", "cohorts", "retention", "funnel", "metrics"],
    pl: ["analityka", "kohorty", "retencja", "lejek", "metryki"],
  },
  availableForRoles: ["system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "tenants.read", scope: "read" }, { key: "users.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
