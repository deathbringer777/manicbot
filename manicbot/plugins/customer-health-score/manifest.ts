import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "customer-health-score",
  version: "0.1.0",
  vendor: "manicbot",
  category: "analytics",
  status: "coming_soon",
  scope: "platform",
  icon: { name: "HeartPulse", tint: "#f43f5e" },
  name: {
    ru: "Health Score клиентов",
    ua: "Health Score клієнтів",
    en: "Customer Health Score",
    pl: "Health Score klientów",
  },
  tagline: {
    ru: "Флаги на уходящих тенантов",
    ua: "Прапори на тенанти під ризиком відтоку",
    en: "Flags at-risk tenants",
    pl: "Flagi na tenantów zagrożonych odpływem",
  },
  description: {
    ru: "Скоринг здоровья: активность, NPS, тикеты, billing. Саппорт видит топ-10 риска в начале недели.",
    ua: "Скоринг здоров'я: активність, NPS, тикети, billing. Саппорт бачить топ-10 ризику на початку тижня.",
    en: "Health scoring: activity, NPS, tickets, billing. Support sees top-10 at-risk tenants weekly.",
    pl: "Skoring kondycji: aktywność, NPS, zgłoszenia, billing. Support widzi top-10 zagrożonych co tydzień.",
  },
  keywords: {
    ru: ["health", "score", "риск", "отток", "churn"],
    ua: ["health", "score", "ризик", "відтік", "churn"],
    en: ["health", "score", "risk", "churn", "at-risk"],
    pl: ["health", "score", "ryzyko", "odejście", "churn"],
  },
  availableForRoles: ["support", "technical_support", "system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "tenants.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
