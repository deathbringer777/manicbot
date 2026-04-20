import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "ticket-templates",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "platform",
  icon: { name: "FileText", tint: "#0ea5e9" },
  name: {
    ru: "Шаблоны ответов",
    ua: "Шаблони відповідей",
    en: "Response Templates",
    pl: "Szablony odpowiedzi",
  },
  tagline: {
    ru: "Готовые фразы — один клик и ответ вставлен",
    ua: "Готові фрази — один клік і відповідь вставлена",
    en: "Ready phrases — one click to paste a reply",
    pl: "Gotowe frazy — jeden klik wkleja odpowiedź",
  },
  description: {
    ru: "Библиотека шаблонов: onboarding, billing, bug-report, prompt-injection. Вставляются в ответ одним кликом.",
    ua: "Бібліотека шаблонів: onboarding, billing, bug-report, prompt-injection. Вставляються в відповідь одним кліком.",
    en: "Template library: onboarding, billing, bug-report, prompt-injection. One-click insert.",
    pl: "Biblioteka szablonów: onboarding, billing, bug-report, prompt-injection. Wstawianie jednym kliknięciem.",
  },
  keywords: {
    ru: ["шаблоны", "ответы", "поддержка", "canned", "support"],
    ua: ["шаблони", "відповіді", "підтримка", "canned", "support"],
    en: ["templates", "canned", "support", "responses", "saved replies"],
    pl: ["szablony", "canned", "wsparcie", "odpowiedzi"],
  },
  availableForRoles: ["support", "technical_support", "system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
