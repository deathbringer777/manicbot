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
    ru: "Защита AI-ассистента",
    ua: "Захист AI-асистента",
    en: "AI Assistant Guard",
    pl: "Ochrona AI-asystenta",
  },
  tagline: {
    ru: "Следит за перерасходом AI и подозрительными запросами",
    ua: "Стежить за перевитратою AI і підозрілими запитами",
    en: "Watches AI overuse and suspicious prompt patterns",
    pl: "Monitoruje nadużycie AI i podejrzane prompty",
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
