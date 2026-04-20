import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "export-hub",
  version: "1.0.0",
  vendor: "manicbot",
  category: "operations",
  status: "live",
  scope: "both",
  icon: { name: "Download", tint: "#3b82f6" },
  name: {
    ru: "Центр экспорта",
    ua: "Центр експорту",
    en: "Export Hub",
    pl: "Centrum eksportu",
  },
  tagline: {
    ru: "CSV / JSON / PDF всего что видит роль",
    ua: "CSV / JSON / PDF всього що бачить роль",
    en: "CSV / JSON / PDF everything your role can see",
    pl: "CSV / JSON / PDF wszystko, co widzi Twoja rola",
  },
  description: {
    ru: "Один клик — экспорт списка клиентов, записей, отчётов, тикетов с учётом прав роли.",
    ua: "Один клік — експорт списку клієнтів, записів, звітів, тикетів з урахуванням прав ролі.",
    en: "One-click export of clients, appointments, reports, tickets — role-aware.",
    pl: "Jeden klik — eksport klientów, wizyt, raportów, zgłoszeń w zakresie uprawnień roli.",
  },
  keywords: {
    ru: ["экспорт", "csv", "json", "pdf", "выгрузка"],
    ua: ["експорт", "csv", "json", "pdf", "вивантаження"],
    en: ["export", "csv", "json", "pdf", "download"],
    pl: ["eksport", "csv", "json", "pdf", "pobierz"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "tenant_manager", "master", "support", "technical_support"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
