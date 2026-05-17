import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "google-calendar",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "tenant",
  icon: { name: "GoogleCalendar", tint: "#4285F4" },
  name: {
    ru: "Google Календарь",
    ua: "Google Календар",
    en: "Google Calendar",
    pl: "Kalendarz Google",
  },
  tagline: {
    ru: "Синхронизация записей с личным Google Календарём",
    ua: "Синхронізація записів з особистим Google Календарем",
    en: "Sync appointments to your personal Google Calendar",
    pl: "Synchronizuj wizyty z osobistym Kalendarzem Google",
  },
  description: {
    ru: "Двусторонняя синхронизация: новые записи мастера автоматически появляются в его Google Календаре, а внешние события из календаря блокируют слоты в боте. Подключение в один клик через OAuth.",
    ua: "Двостороння синхронізація: нові записи майстра автоматично з'являються у його Google Календарі, а зовнішні події з календаря блокують слоти в боті. Підключення в один клік через OAuth.",
    en: "Two-way sync: new master bookings auto-appear in their Google Calendar, and external events from the calendar block bot slots. One-click OAuth connect.",
    pl: "Synchronizacja dwukierunkowa: nowe rezerwacje mistrza automatycznie pojawiają się w jego Kalendarzu Google, a zewnętrzne wydarzenia blokują sloty w bocie. Połączenie OAuth jednym kliknięciem.",
  },
  keywords: {
    ru: ["google", "календарь", "синхронизация", "oauth", "gcal"],
    ua: ["google", "календар", "синхронізація", "oauth", "gcal"],
    en: ["google", "calendar", "sync", "oauth", "gcal"],
    pl: ["google", "kalendarz", "synchronizacja", "oauth", "gcal"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager", "master"],
  minPlan: "pro",
  billing: { model: "included_in_plan", featureKey: "google-calendar" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
