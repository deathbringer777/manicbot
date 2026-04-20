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
    ru: "Учёт материалов Lite",
    ua: "Облік матеріалів Lite",
    en: "Inventory Lite",
    pl: "Inwentarz Lite",
  },
  tagline: {
    ru: "Расход материалов на каждую услугу",
    ua: "Витрата матеріалів на кожну послугу",
    en: "Track material consumption per service",
    pl: "Śledzenie zużycia materiałów na usługę",
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
