import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "commission-calc",
  version: "0.1.0",
  vendor: "manicbot",
  category: "finance",
  status: "beta",
  scope: "tenant",
  icon: { name: "Receipt", tint: "#22c55e" },
  name: {
    ru: "Расчёт комиссий мастеров",
    ua: "Розрахунок комісій майстрів",
    en: "Commission Calculator",
    pl: "Kalkulator prowizji",
  },
  tagline: {
    ru: "Процент мастеру с каждой услуги — автоматически",
    ua: "Відсоток майстру з кожної послуги — автоматично",
    en: "Automatic commission from every service",
    pl: "Automatyczna prowizja z każdej usługi",
  },
  description: {
    ru: "Настройте формулу: процент от услуги, фиксированная ставка, прогрессивная шкала. Отчёты к зарплатному дню.",
    ua: "Налаштуйте формулу: відсоток від послуги, фіксована ставка, прогресивна шкала. Звіти до зарплатного дня.",
    en: "Configure a formula: percent of service, flat rate, progressive tiers. Payday reports.",
    pl: "Skonfiguruj formułę: procent od usługi, stawka, progresywne progi. Raporty na dzień wypłaty.",
  },
  keywords: {
    ru: ["комиссия", "зарплата", "процент", "мастера", "расчёт"],
    ua: ["комісія", "зарплата", "відсоток", "майстри", "розрахунок"],
    en: ["commission", "payroll", "percent", "masters", "calc"],
    pl: ["prowizja", "wynagrodzenie", "procent", "kalkulator"],
  },
  availableForRoles: ["tenant_manager", "tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "appointments.read", scope: "read" }, { key: "masters.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
