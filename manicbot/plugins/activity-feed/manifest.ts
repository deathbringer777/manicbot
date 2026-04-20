import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "activity-feed",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "both",
  icon: { name: "Activity", tint: "#22c55e" },
  name: {
    ru: "Лента активности",
    ua: "Стрічка активності",
    en: "Activity Feed",
    pl: "Strumień aktywności",
  },
  tagline: {
    ru: "Боковая панель с последними событиями",
    ua: "Бічна панель з останніми подіями",
    en: "Side drawer with recent events",
    pl: "Boczny panel z ostatnimi zdarzeniami",
  },
  description: {
    ru: "Правая выезжающая панель показывает свежие события: новые записи, жалобы, платежи. Refetch 5s.",
    ua: "Права висувна панель показує свіжі події: нові записи, скарги, платежі. Refetch 5s.",
    en: "Right-side drawer with fresh events: new bookings, complaints, payments. 5s refresh.",
    pl: "Prawy panel z bieżącymi zdarzeniami: nowe rezerwacje, skargi, płatności. Odświeżanie co 5s.",
  },
  keywords: {
    ru: ["активность", "лента", "события", "drawer", "уведомления"],
    ua: ["активність", "стрічка", "події", "drawer", "повідомлення"],
    en: ["activity", "feed", "events", "drawer", "notifications"],
    pl: ["aktywność", "strumień", "zdarzenia", "panel", "powiadomienia"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "tenant_manager", "master", "support", "technical_support"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "events.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
