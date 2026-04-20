import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "fraud-shield",
  version: "0.1.0",
  vendor: "manicbot",
  category: "compliance",
  status: "coming_soon",
  scope: "platform",
  icon: { name: "Lock", tint: "#f97316" },
  name: {
    ru: "Защита от мошенничества",
    ua: "Захист від шахрайства",
    en: "Fraud Protection",
    pl: "Ochrona przed oszustwami",
  },
  tagline: {
    ru: "Блокирует подозрительные регистрации и дубликаты",
    ua: "Блокує підозрілі реєстрації та дублікати",
    en: "Blocks suspicious signups and duplicates",
    pl: "Blokuje podejrzane rejestracje i duplikaty",
  },
  description: {
    ru: "Блокирует регистрации с abuse-адресов, детектит одинаковые устройства и email-шаблоны.",
    ua: "Блокує реєстрації з abuse-адрес, детектує однакові пристрої та email-шаблони.",
    en: "Blocks signups from abuse networks, detects fingerprint and email clones.",
    pl: "Blokuje rejestracje z sieci abuse, wykrywa klony odcisków palców i e-maili.",
  },
  keywords: {
    ru: ["мошенничество", "fraud", "безопасность", "IP", "abuse"],
    ua: ["шахрайство", "fraud", "безпека", "IP", "abuse"],
    en: ["fraud", "security", "ip", "abuse", "duplicate"],
    pl: ["oszustwo", "fraud", "bezpieczeństwo", "ip", "abuse"],
  },
  availableForRoles: ["system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "users.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
