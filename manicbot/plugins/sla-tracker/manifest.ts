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
    ru: "Скорость ответа саппорта",
    ua: "Швидкість відповіді саппорту",
    en: "Support Response Speed",
    pl: "Szybkość odpowiedzi wsparcia",
  },
  tagline: {
    ru: "Как быстро мы отвечаем на тикеты",
    ua: "Як швидко ми відповідаємо на тикети",
    en: "How fast we respond to tickets",
    pl: "Jak szybko odpowiadamy na zgłoszenia",
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
