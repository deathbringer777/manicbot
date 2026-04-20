import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "inventory-lite",
  version: "0.1.0",
  vendor: "manicbot",
  category: "operations",
  status: "coming_soon",
  scope: "tenant",
  icon: { name: "ShoppingBag", tint: "#14b8a6" },
  name: {
    ru: "Учёт материалов",
    ua: "Облік матеріалів",
    en: "Supplies Tracking",
    pl: "Ewidencja materiałów",
  },
  tagline: {
    ru: "Сколько гель-лака осталось на складе",
    ua: "Скільки гель-лаку лишилось на складі",
    en: "Know when it's time to restock supplies",
    pl: "Wiedz kiedy uzupełnić zapasy",
  },
  description: {
    ru: "Свяжите услуги с расходными материалами. Автосписание остатков. Уведомления о необходимости пополнить склад.",
    ua: "Пов'яжіть послуги з витратними матеріалами. Автосписання залишків. Сповіщення про необхідність поповнити склад.",
    en: "Link services to consumables. Auto-decrement stock. Low-stock alerts.",
    pl: "Powiąż usługi z materiałami eksploatacyjnymi. Automatyczne odpisywanie stanu. Powiadomienia o niskim stanie.",
  },
  keywords: {
    ru: ["склад", "материалы", "учёт", "остатки", "расходники"],
    ua: ["склад", "матеріали", "облік", "залишки", "витратники"],
    en: ["inventory", "materials", "stock", "consumables", "supplies"],
    pl: ["magazyn", "materiały", "zapasy", "eksploatacja", "stan"],
  },
  availableForRoles: ["tenant_manager", "tenant_owner"],
  minPlan: "pro",
  billing: {
    model: "paid_addon_monthly",
    stripePriceIdEnv: "STRIPE_PRICE_INVENTORY_LITE_MONTHLY",
    priceHintUsd: 7,
  },
  permissions: [{ key: "services.manage", scope: "write", sensitive: true }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
