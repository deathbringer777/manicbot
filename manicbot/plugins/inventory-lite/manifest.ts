import type { PluginManifest } from "../types";

/**
 * Inventory Lite — Variant A plugin #3 (after loyalty-stamps + review-collector).
 *
 * Tracks salon consumables (gel, base, polish, tools) with manual quantity
 * decrement + a low-stock visual flag. Settings-only (no D1 migration): the
 * inventory list is stored as a JSON array on plugin_installations.settings_json
 * (capped at 8 KB by the plugin contract, fits ~80 items).
 *
 * MVP is intentionally manual — no auto-decrement per service, no purchase
 * orders. Once the salon stops losing track of the gel-polish stock,
 * automation can come as `inventory-pro` in a later wave.
 */
const manifest: PluginManifest = {
  slug: "inventory-lite",
  version: "1.0.0",
  vendor: "manicbot",
  category: "operations",
  status: "live",
  scope: "tenant",
  icon: { name: "Boxes", tint: "#f97316" },
  name: {
    ru: "Склад: материалы",
    ua: "Склад: матеріали",
    en: "Inventory: supplies",
    pl: "Magazyn: materiały",
  },
  tagline: {
    ru: "Считаем гели, базы и палочки — без таблиц в WhatsApp",
    ua: "Рахуємо гелі, бази й палички — без таблиць у WhatsApp",
    en: "Track gel, base and tools — no more spreadsheets in WhatsApp",
    pl: "Liczymy żele, bazy i narzędzia — bez arkuszy w WhatsApp",
  },
  description: {
    ru: "Простой реестр расходников с пометкой «мало осталось». Каждой позиции — название, остаток, порог тревоги и единица измерения. Заводи во время заказа у поставщика, обновляй после смены — больше никаких сюрпризов «о, гель закончился».",
    ua: "Простий реєстр витратних матеріалів з позначкою «залишилось мало». Кожній позиції — назва, залишок, поріг тривоги та одиниця виміру. Заводь під час замовлення у постачальника, оновлюй після зміни — жодних сюрпризів «о, гель закінчився».",
    en: "A simple consumables register with low-stock highlighting. Each line carries name, current count, alert threshold, and unit. Add items when ordering from your supplier, decrement after each shift — no more \"oh, we ran out of gel\" surprises.",
    pl: "Prosty rejestr materiałów eksploatacyjnych z oznaczeniem „mało zapasu\". Każda pozycja ma nazwę, stan, próg alarmowy i jednostkę. Dodawaj przy zamawianiu u dostawcy, aktualizuj po zmianie — koniec niespodzianek „o, skończył się żel\".",
  },
  keywords: {
    ru: ["склад", "материалы", "расходники", "гель", "остатки", "поставка"],
    ua: ["склад", "матеріали", "витратні", "гель", "залишки", "постачання"],
    en: ["inventory", "stock", "supplies", "gel", "consumables", "supplier"],
    pl: ["magazyn", "stan", "materiały", "żel", "zapasy", "dostawca"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager", "master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
