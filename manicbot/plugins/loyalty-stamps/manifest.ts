import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "loyalty-stamps",
  version: "1.0.0",
  vendor: "manicbot",
  category: "growth",
  status: "live",
  scope: "tenant",
  icon: { name: "Star", tint: "#eab308" },
  name: {
    ru: "Штамп-карта лояльности",
    ua: "Штамп-картка лояльності",
    en: "Loyalty Stamps",
    pl: "Karty lojalnościowe",
  },
  tagline: {
    ru: "6 визитов — 7-й бесплатно",
    ua: "6 візитів — 7-й безкоштовно",
    en: "6 visits — 7th free",
    pl: "6 wizyt — 7. gratis",
  },
  description: {
    ru: "Автоматическая накопительная карта: каждый клиент получает штамп после услуги, на 7-й визит — скидка или подарок.",
    ua: "Автоматична накопичувальна картка: кожен клієнт отримує штамп після послуги, на 7-й візит — знижка або подарунок.",
    en: "Stamp card auto-tracking: each client gets a stamp after service; on the 7th visit — discount or gift.",
    pl: "Automatyczna karta stemplowa: klient dostaje stempel po usłudze; 7. wizyta — zniżka lub prezent.",
  },
  keywords: {
    ru: ["лояльность", "карта", "штамп", "скидка", "подарок"],
    ua: ["лояльність", "картка", "штамп", "знижка", "подарунок"],
    en: ["loyalty", "stamps", "card", "reward", "discount"],
    pl: ["lojalność", "stemple", "karta", "nagroda", "zniżka"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "clients.read", scope: "read" }, { key: "appointments.manage", scope: "write" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
