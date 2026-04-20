import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "command-palette",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "both",
  icon: { name: "Compass", tint: "#6366f1" },
  name: {
    ru: "Command Palette",
    ua: "Command Palette",
    en: "Command Palette",
    pl: "Paleta poleceń",
  },
  tagline: {
    ru: "Cmd+K — глобальный поиск и действия",
    ua: "Cmd+K — глобальний пошук і дії",
    en: "Cmd+K — global search and actions",
    pl: "Cmd+K — globalne wyszukiwanie i akcje",
  },
  description: {
    ru: "Единый поиск по тенантам, пользователям, записям, лидам + быстрые действия (создать тенант, забанить) через клавиатуру.",
    ua: "Єдиний пошук по тенантах, користувачах, записах, лідах + швидкі дії (створити тенант, забанити) через клавіатуру.",
    en: "One search across tenants, users, appointments, leads + quick actions (create tenant, ban user) via keyboard.",
    pl: "Jedno wyszukiwanie we wszystkim + szybkie akcje z klawiatury (utworzenie tenanta, ban).",
  },
  keywords: {
    ru: ["cmd+k", "поиск", "палитра", "горячие клавиши", "shortcut"],
    ua: ["cmd+k", "пошук", "палітра", "гарячі клавіші", "shortcut"],
    en: ["cmd+k", "palette", "search", "shortcut", "quick actions"],
    pl: ["cmd+k", "paleta", "wyszukiwanie", "skrót"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "tenant_manager", "master", "support", "technical_support"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
