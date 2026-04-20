import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "gdpr-center",
  version: "1.0.0",
  vendor: "manicbot",
  category: "compliance",
  status: "live",
  scope: "platform",
  icon: { name: "Shield", tint: "#6366f1" },
  name: {
    ru: "GDPR Center",
    ua: "GDPR Center",
    en: "GDPR Center",
    pl: "GDPR Center",
  },
  tagline: {
    ru: "Журнал согласий и запросы на удаление",
    ua: "Журнал згод і запити на видалення",
    en: "Consent log and data-erasure requests",
    pl: "Dziennik zgód i wnioski o usunięcie danych",
  },
  description: {
    ru: "Audit trail для opt-in / opt-out событий, экспорт данных субъекта, отчёты о breach.",
    ua: "Audit trail для opt-in / opt-out подій, експорт даних суб'єкта, звіти про breach.",
    en: "Audit trail of opt-in / opt-out events, subject data export, breach reports.",
    pl: "Ślad audytu zgód opt-in/opt-out, eksport danych osoby, raporty naruszeń.",
  },
  keywords: {
    ru: ["GDPR", "приватность", "согласия", "consent", "data"],
    ua: ["GDPR", "приватність", "згоди", "consent", "data"],
    en: ["gdpr", "privacy", "consent", "audit", "data export"],
    pl: ["gdpr", "prywatność", "zgody", "consent", "eksport danych"],
  },
  availableForRoles: ["system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "marketing.consent.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
