import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "sla-tracker",
  version: "1.0.0",
  vendor: "manicbot",
  category: "analytics",
  status: "live",
  scope: "platform",
  icon: { name: "Timer", tint: "#10b981" },
  name: {
    ru: "SLA Tracker",
    ua: "SLA Tracker",
    en: "SLA Tracker",
    pl: "SLA Tracker",
  },
  tagline: {
    ru: "Время до первого ответа и SLA-компаянс",
    ua: "Час до першої відповіді і SLA-комплайанс",
    en: "Time-to-first-response and SLA compliance",
    pl: "Czas pierwszej odpowiedzi i zgodność SLA",
  },
  description: {
    ru: "Медиана TTFR, breach-тикеты, heat map нагрузки по часам. Для саппорта — зелёный/жёлтый/красный статус.",
    ua: "Медіана TTFR, breach-тикети, heat map навантаження по годинах. Для саппорту — зелений/жовтий/червоний статус.",
    en: "Median TTFR, breached tickets, hourly load heat map. Green/yellow/red status.",
    pl: "Mediana TTFR, zgłoszenia przekraczające SLA, heat-mapa obciążenia. Status zielony/żółty/czerwony.",
  },
  keywords: {
    ru: ["SLA", "TTFR", "ответ", "метрики", "поддержка"],
    ua: ["SLA", "TTFR", "відповідь", "метрики", "підтримка"],
    en: ["sla", "ttfr", "response", "metrics", "support"],
    pl: ["sla", "ttfr", "odpowiedź", "metryki", "wsparcie"],
  },
  availableForRoles: ["support", "technical_support", "system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "tickets.read", scope: "read" }],
  capabilities: { healthCheck: true },
  lifecycle: {},
};

export default manifest;
