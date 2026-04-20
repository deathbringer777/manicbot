import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "tip-jar",
  version: "0.1.0",
  vendor: "manicbot",
  category: "finance",
  status: "coming_soon",
  scope: "tenant",
  icon: { name: "Coffee", tint: "#f59e0b" },
  name: {
    ru: "Чаевые мастеру",
    ua: "Чайові майстру",
    en: "Tip Jar",
    pl: "Napiwki",
  },
  tagline: {
    ru: "Ссылка на чаевые в подтверждении записи",
    ua: "Посилання на чайові в підтвердженні запису",
    en: "Tip link in the booking confirmation",
    pl: "Link na napiwki w potwierdzeniu wizyty",
  },
  description: {
    ru: "После услуги клиент получает ссылку на оплату чаевых. Интеграция с Revolut / Stripe.",
    ua: "Після послуги клієнт отримує посилання на оплату чайових. Інтеграція з Revolut / Stripe.",
    en: "After service, client gets a tip link. Revolut / Stripe integration.",
    pl: "Po usłudze klient dostaje link do napiwku. Integracja Revolut / Stripe.",
  },
  keywords: {
    ru: ["чаевые", "tip", "оплата", "revolut", "ссылка"],
    ua: ["чайові", "tip", "оплата", "revolut", "посилання"],
    en: ["tips", "tip jar", "payment", "revolut", "link"],
    pl: ["napiwki", "tip", "płatność", "revolut", "link"],
  },
  availableForRoles: ["master"],
  minPlan: "any",
  billing: {
    model: "paid_addon_onetime",
    stripePriceIdEnv: "STRIPE_PRICE_TIP_JAR_ONETIME",
    priceHintUsd: 19,
  },
  permissions: [{ key: "settings.manage", scope: "write", sensitive: true }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
