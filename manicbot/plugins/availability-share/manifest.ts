import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "availability-share",
  version: "1.0.0",
  vendor: "manicbot",
  category: "growth",
  status: "live",
  scope: "tenant",
  icon: { name: "Link2", tint: "#22c55e" },
  name: {
    ru: "Прямая ссылка на запись",
    ua: "Пряме посилання на запис",
    en: "Availability Share",
    pl: "Link do rezerwacji",
  },
  tagline: {
    ru: "Короткая ссылка для instagram bio",
    ua: "Коротке посилання для instagram bio",
    en: "Short link for Instagram bio",
    pl: "Krótki link do Instagram bio",
  },
  description: {
    ru: "Персональная ссылка мастера с его доступными окнами. Удобно в bio соцсетей.",
    ua: "Персональне посилання майстра з його доступними вікнами. Зручно в bio соцмереж.",
    en: "Personal link showing the master's open slots. Perfect for social bios.",
    pl: "Osobisty link z dostępnymi oknami mistrza. Świetny do biogramów w social media.",
  },
  keywords: {
    ru: ["ссылка", "запись", "bio", "instagram", "публичный"],
    ua: ["посилання", "запис", "bio", "instagram", "публічний"],
    en: ["link", "booking", "bio", "instagram", "public"],
    pl: ["link", "rezerwacja", "bio", "instagram", "publiczny"],
  },
  availableForRoles: ["master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
