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
    ru: "Большая аналитика платформы",
    ua: "Велика аналітика платформи",
    en: "Platform Analytics",
    pl: "Analityka platformy",
  },
  tagline: {
    ru: "Как растут салоны, где отваливаются и что работает",
    ua: "Як ростуть салони, де відвалюються і що працює",
    en: "How salons grow, where they drop off, what works",
    pl: "Jak salony rosną, gdzie odpadają i co działa",
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
