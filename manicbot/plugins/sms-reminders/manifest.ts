import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "sms-reminders",
  version: "1.0.0",
  vendor: "manicbot",
  category: "communication",
  status: "live",
  scope: "tenant",
  icon: { name: "Bell", tint: "#f59e0b" },
  name: {
    ru: "SMS-напоминания",
    ua: "SMS-нагадування",
    en: "SMS Reminders",
    pl: "Przypomnienia SMS",
  },
  tagline: {
    ru: "Автоматические SMS клиентам за сутки и за два часа",
    ua: "Автоматичні SMS клієнтам за добу і за дві години",
    en: "Automatic SMS 24h and 2h before appointments",
    pl: "Automatyczne SMS 24h i 2h przed wizytą",
  },
  description: {
    ru: "Снижает количество no-show на 30-50%. Шаблоны на 4 языках, отправка через Brevo SMS API. Подключается в пару кликов.",
    ua: "Знижує кількість no-show на 30-50%. Шаблони 4 мовами, відправка через Brevo SMS API. Підключається в пару кліків.",
    en: "Cuts no-shows by 30–50%. Localized templates, sends via Brevo SMS API. Connects in two clicks.",
    pl: "Redukuje no-show o 30–50%. Szablony w 4 językach, wysyłka przez Brevo SMS API. Podłącza się w dwa kliknięcia.",
  },
  keywords: {
    ru: ["смс", "sms", "напоминания", "уведомления", "no-show"],
    ua: ["смс", "sms", "нагадування", "повідомлення", "no-show"],
    en: ["sms", "reminders", "notifications", "no-show", "text"],
    pl: ["sms", "przypomnienia", "powiadomienia", "no-show"],
  },
  availableForRoles: ["tenant_owner", "tenant_manager"],
  minPlan: "pro",
  billing: {
    model: "paid_addon_monthly",
    stripePriceIdEnv: "STRIPE_PRICE_SMS_REMINDERS_MONTHLY",
    priceHintUsd: 9,
    label: {
      ru: "$9/мес",
      ua: "$9/міс",
      en: "$9/mo",
      pl: "$9/mies",
    },
  },
  permissions: [
    { key: "appointments.read", scope: "read" },
    { key: "clients.read", scope: "read" },
    { key: "sms.send", scope: "write", sensitive: true },
  ],
  capabilities: { healthCheck: true },
  lifecycle: {},
};

export default manifest;
