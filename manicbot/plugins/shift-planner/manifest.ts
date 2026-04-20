import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "shift-planner",
  version: "0.1.0",
  vendor: "manicbot",
  category: "operations",
  status: "beta",
  scope: "tenant",
  icon: { name: "CalendarCheck", tint: "#8b5cf6" },
  name: {
    ru: "Планировщик смен",
    ua: "Планувальник змін",
    en: "Shift Planner",
    pl: "Planner zmian",
  },
  tagline: {
    ru: "Недельное расписание смен мастеров",
    ua: "Тижневий розклад змін майстрів",
    en: "Weekly shift schedule for staff",
    pl: "Tygodniowy grafik zmian personelu",
  },
  description: {
    ru: "Drag-and-drop редактор смен на неделю. Экспорт в CSV. Интеграция с рабочими часами салона.",
    ua: "Drag-and-drop редактор змін на тиждень. Експорт в CSV. Інтеграція з робочими годинами салону.",
    en: "Drag-and-drop weekly shift editor. CSV export. Integrates with salon hours.",
    pl: "Edytor zmian drag-and-drop. Eksport CSV. Integracja z godzinami salonu.",
  },
  keywords: {
    ru: ["смены", "расписание", "график", "планирование", "персонал"],
    ua: ["зміни", "розклад", "графік", "планування", "персонал"],
    en: ["shifts", "schedule", "planner", "staff", "calendar"],
    pl: ["zmiany", "grafik", "planner", "personel", "kalendarz"],
  },
  availableForRoles: ["tenant_manager", "tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "masters.read", scope: "read" }, { key: "staff.manage", scope: "write", sensitive: true }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
