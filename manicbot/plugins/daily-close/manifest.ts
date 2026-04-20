import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "daily-close",
  version: "0.1.0",
  vendor: "manicbot",
  category: "finance",
  status: "coming_soon",
  scope: "tenant",
  icon: { name: "Wallet", tint: "#a855f7" },
  name: {
    ru: "Закрытие дня",
    ua: "Закриття дня",
    en: "Daily Close",
    pl: "Zamknięcie dnia",
  },
  tagline: {
    ru: "EOD сверка наличных и карт",
    ua: "EOD звірка готівки й карт",
    en: "End-of-day cash & card reconciliation",
    pl: "Rozliczenie końca dnia: gotówka i karty",
  },
  description: {
    ru: "В конце дня менеджер сверяет кассу, учитывает чаевые и расходы. Отчёт уходит владельцу утром.",
    ua: "В кінці дня менеджер звіряє касу, враховує чайові й витрати. Звіт йде власнику зранку.",
    en: "Manager reconciles register, tips and expenses at close. Morning report to owner.",
    pl: "Menedżer rozlicza kasę, napiwki i wydatki na koniec dnia. Raport rano do właściciela.",
  },
  keywords: {
    ru: ["касса", "сверка", "закрытие", "наличные", "EOD"],
    ua: ["каса", "звірка", "закриття", "готівка", "EOD"],
    en: ["cash", "reconcile", "close", "eod", "register"],
    pl: ["kasa", "rozliczenie", "zamknięcie", "gotówka", "eod"],
  },
  availableForRoles: ["tenant_manager", "tenant_owner"],
  minPlan: "pro",
  billing: { model: "included_in_plan", featureKey: "support" },
  permissions: [{ key: "billing.manage", scope: "write", sensitive: true }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
