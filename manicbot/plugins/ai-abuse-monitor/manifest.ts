import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "ai-abuse-monitor",
  version: "1.0.0",
  vendor: "manicbot",
  category: "ai",
  status: "live",
  scope: "platform",
  icon: { name: "Shield", tint: "#ef4444" },
  name: {
    ru: "AI Abuse Monitor",
    ua: "AI Abuse Monitor",
    en: "AI Abuse Monitor",
    pl: "AI Abuse Monitor",
  },
  tagline: {
    ru: "Спайки расхода AI и prompt-injection попытки",
    ua: "Спайки витрат AI і спроби prompt-injection",
    en: "AI usage spikes and prompt-injection attempts",
    pl: "Skoki użycia AI i próby prompt-injection",
  },
  description: {
    ru: "Отслеживает тенанты с аномально высоким расходом AI, блокирует prompt-injection паттерны, пишет в events.",
    ua: "Відстежує тенанти з аномально високою витратою AI, блокує prompt-injection патерни, пише в events.",
    en: "Flags tenants burning AI quota, blocks prompt-injection patterns, emits events.",
    pl: "Wykrywa tenantów z nadmiernym zużyciem AI, blokuje wzorce prompt-injection, wysyła zdarzenia.",
  },
  keywords: {
    ru: ["AI", "безопасность", "abuse", "prompt", "injection", "rate limit"],
    ua: ["AI", "безпека", "abuse", "prompt", "injection", "rate limit"],
    en: ["ai", "security", "abuse", "prompt", "injection", "rate limit"],
    pl: ["ai", "bezpieczeństwo", "abuse", "prompt", "injection", "limit"],
  },
  availableForRoles: ["system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "events.read", scope: "read" }],
  capabilities: { healthCheck: true },
  lifecycle: {},
};

export default manifest;
