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
    ru: "Fraud Shield",
    ua: "Fraud Shield",
    en: "Fraud Shield",
    pl: "Fraud Shield",
  },
  tagline: {
    ru: "IP-репутация и детекция дубликатов при регистрации",
    ua: "IP-репутація і виявлення дублікатів при реєстрації",
    en: "IP reputation and duplicate signup detection",
    pl: "Reputacja IP i wykrywanie duplikatów rejestracji",
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
