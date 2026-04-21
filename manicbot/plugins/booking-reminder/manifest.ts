import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "booking-reminder",
  version: "1.0.0",
  vendor: "manicbot",
  category: "communication",
  status: "live",
  scope: "tenant",
  icon: { name: "BellRing", tint: "#3b82f6" },
  name: {
    ru: "Напоминания о записях",
    ua: "Нагадування про записи",
    en: "Booking Reminders",
    pl: "Przypomnienia o wizytach",
  },
  tagline: {
    ru: "Быстро скопируйте шаблон напоминания для клиента",
    ua: "Швидко скопіюйте шаблон нагадування для клієнта",
    en: "Quickly copy a reminder template for any client",
    pl: "Szybko skopiuj szablon przypomnienia dla klienta",
  },
  description: {
    ru: "Показывает ближайшие записи на сегодня. Нажмите «Скопировать» рядом с записью — готовый текст напоминания скопируется в буфер и его можно отправить клиенту в Telegram.",
    ua: "Показує найближчі записи на сьогодні. Натисніть «Копіювати» поруч із записом — готовий текст нагадування скопіюється в буфер і його можна надіслати клієнту в Telegram.",
    en: "Shows today's upcoming appointments. Click Copy next to any appointment to get a ready-to-send reminder text for the client.",
    pl: "Pokazuje najbliższe wizyty na dziś. Kliknij Kopiuj obok wizyty — gotowy tekst przypomnienia trafi do schowka i można go wysłać klientowi przez Telegram.",
  },
  keywords: {
    ru: ["напоминания", "запись", "клиент", "сообщение", "copy"],
    ua: ["нагадування", "запис", "клієнт", "повідомлення", "copy"],
    en: ["reminder", "booking", "appointment", "copy", "client"],
    pl: ["przypomnienie", "wizyta", "klient", "wiadomość", "kopiowanie"],
  },
  availableForRoles: ["master", "tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {
    settingsPanel: {
      sectionKey: "plugin:booking-reminder",
      componentId: "plugin:booking-reminder:settings",
    },
  },
  lifecycle: {},
};

export default manifest;
