import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "birthday-campaigns",
  version: "0.1.0",
  vendor: "manicbot",
  category: "growth",
  status: "beta",
  scope: "tenant",
  icon: { name: "Gift", tint: "#ec4899" },
  name: {
    ru: "Поздравления с днём рождения",
    ua: "Привітання з днем народження",
    en: "Birthday Campaigns",
    pl: "Kampanie urodzinowe",
  },
  tagline: {
    ru: "Автоматическая скидка ко дню рождения клиента",
    ua: "Автоматична знижка до дня народження клієнта",
    en: "Automatic birthday discount for every client",
    pl: "Automatyczna zniżka urodzinowa dla każdego klienta",
  },
  description: {
    ru: "За N дней до дня рождения клиенту приходит персональный промо-код. Настраиваемый шаблон и скидка.",
    ua: "За N днів до дня народження клієнту приходить персональний промо-код. Налаштовуваний шаблон і знижка.",
    en: "Sends a personalized promo code N days before each client's birthday. Customizable template and discount.",
    pl: "Wysyła spersonalizowany kod N dni przed urodzinami klienta. Własne szablony i zniżki.",
  },
  keywords: {
    ru: ["день рождения", "промо", "скидка", "автоматизация", "кампания"],
    ua: ["день народження", "промо", "знижка", "автоматизація", "кампанія"],
    en: ["birthday", "promo", "discount", "automation", "campaign"],
    pl: ["urodziny", "promo", "zniżka", "automatyzacja", "kampania"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager"],
  minPlan: "pro",
  billing: { model: "included_in_plan", featureKey: "ai" },
  permissions: [{ key: "clients.read", scope: "read" }, { key: "marketing.send", scope: "write", sensitive: true }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
