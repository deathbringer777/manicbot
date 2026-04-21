import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "google-calendar",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "tenant",
  icon: { name: "CalendarCheck2", tint: "#4285f4" },
  name: {
    ru: "Google Календарь",
    ua: "Google Календар",
    en: "Google Calendar",
    pl: "Kalendarz Google",
  },
  tagline: {
    ru: "Синхронизируйте записи с Google Календарём в реальном времени",
    ua: "Синхронізуйте записи з Google Календарем у реальному часі",
    en: "Sync appointments with Google Calendar in real time",
    pl: "Synchronizuj wizyty z Kalendarzem Google w czasie rzeczywistym",
  },
  description: {
    ru: "Двусторонняя синхронизация записей с Google Календарём. Мастера видят расписание в привычном интерфейсе, а занятые слоты автоматически блокируются в боте.",
    ua: "Двостороння синхронізація записів із Google Календарем. Майстри бачать розклад у звичному інтерфейсі, а зайняті слоти автоматично блокуються в боті.",
    en: "Two-way sync of appointments with Google Calendar. Masters see their schedule in a familiar interface, and busy slots are automatically blocked in the bot.",
    pl: "Dwustronna synchronizacja wizyt z Kalendarzem Google. Mistrzowie widzą harmonogram w znajomym interfejsie, a zajęte sloty są automatycznie blokowane w bocie.",
  },
  keywords: {
    ru: ["google", "календарь", "синхронизация", "расписание", "schedule", "sync"],
    ua: ["google", "календар", "синхронізація", "розклад", "schedule", "sync"],
    en: ["google", "calendar", "sync", "schedule", "synchronization"],
    pl: ["google", "kalendarz", "synchronizacja", "harmonogram", "schedule", "sync"],
  },
  availableForRoles: ["tenant_owner", "master"],
  minPlan: "pro",
  billing: { model: "included_in_plan", featureKey: "google_calendar" },
  permissions: [
    { key: "calendar.read", scope: "read" },
    { key: "calendar.write", scope: "write", sensitive: true },
  ],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
