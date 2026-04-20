import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "no-show-shield",
  version: "0.1.0",
  vendor: "manicbot",
  category: "operations",
  status: "coming_soon",
  scope: "tenant",
  icon: { name: "Shield", tint: "#64748b" },
  name: {
    ru: "Защита от неявки",
    ua: "Захист від неявки",
    en: "No-Show Shield",
    pl: "Ochrona przed nieobecnością",
  },
  tagline: {
    ru: "Депозит для повторных нарушителей",
    ua: "Депозит для повторних порушників",
    en: "Deposit hold for repeat offenders",
    pl: "Kaucja dla powtarzających nieobecności",
  },
  description: {
    ru: "После 2 пропущенных записей клиент обязан оставлять депозит при бронировании. Возврат при приходе.",
    ua: "Після 2 пропущених записів клієнт зобов'язаний залишати депозит при бронюванні. Повернення при приході.",
    en: "After 2 no-shows, the client must pay a deposit to book again. Refunded on arrival.",
    pl: "Po 2 nieobecnościach klient musi wpłacić kaucję przy rezerwacji. Zwrot po przybyciu.",
  },
  keywords: {
    ru: ["неявка", "no-show", "депозит", "защита", "отмена"],
    ua: ["неявка", "no-show", "депозит", "захист", "скасування"],
    en: ["no-show", "deposit", "shield", "cancellation"],
    pl: ["nieobecność", "no-show", "kaucja", "ochrona"],
  },
  availableForRoles: ["tenant_owner"],
  minPlan: "pro",
  billing: {
    model: "paid_addon_monthly",
    stripePriceIdEnv: "STRIPE_PRICE_NO_SHOW_SHIELD_MONTHLY",
    priceHintUsd: 5,
  },
  permissions: [
    { key: "appointments.manage", scope: "write" },
    { key: "billing.manage", scope: "write", sensitive: true },
  ],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
