import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "dark-plus",
  version: "0.1.0",
  vendor: "manicbot",
  category: "branding",
  status: "beta",
  scope: "both",
  icon: { name: "Moon", tint: "#1e293b" },
  name: {
    ru: "Dark+",
    ua: "Dark+",
    en: "Dark+",
    pl: "Dark+",
  },
  tagline: {
    ru: "Дополнительные тёмные темы",
    ua: "Додаткові темні теми",
    en: "Extra dark themes",
    pl: "Dodatkowe ciemne motywy",
  },
  description: {
    ru: "OLED Black, Midnight Blue, Dracula. Переключение по роли без перезагрузки.",
    ua: "OLED Black, Midnight Blue, Dracula. Перемикання по ролі без перезавантаження.",
    en: "OLED Black, Midnight Blue, Dracula. Switch per role, no reload.",
    pl: "OLED Black, Midnight Blue, Dracula. Zmiana wg roli, bez przeładowania.",
  },
  keywords: {
    ru: ["темы", "тёмная", "dark", "oled", "midnight"],
    ua: ["теми", "темна", "dark", "oled", "midnight"],
    en: ["themes", "dark", "oled", "midnight", "dracula"],
    pl: ["motywy", "ciemny", "dark", "oled", "midnight"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "tenant_manager", "master", "support", "technical_support"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
