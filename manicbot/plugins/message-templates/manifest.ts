import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "message-templates",
  version: "1.0.0",
  vendor: "manicbot",
  category: "communication",
  status: "live",
  scope: "tenant",
  icon: { name: "MessageSquareQuote", tint: "#8b5cf6" },
  name: {
    ru: "Шаблоны сообщений",
    ua: "Шаблони повідомлень",
    en: "Message Templates",
    pl: "Szablony wiadomości",
  },
  tagline: {
    ru: "Готовые тексты для частых ситуаций — одним кликом",
    ua: "Готові тексти для частих ситуацій — одним кліком",
    en: "Ready-made texts for common situations — one click to copy",
    pl: "Gotowe teksty na częste sytuacje — kopiowanie jednym kliknięciem",
  },
  description: {
    ru: "Храните шаблоны ответов и уведомлений. Добавляйте, редактируйте и удаляйте шаблоны. Нажмите «Скопировать» — и текст готов к отправке в Telegram или другом канале.",
    ua: "Зберігайте шаблони відповідей і сповіщень. Додавайте, редагуйте та видаляйте шаблони. Натисніть «Копіювати» — і текст готовий до надсилання в Telegram або іншому каналі.",
    en: "Store reply and notification templates. Add, edit, and delete templates. Click Copy and the text is ready to send on Telegram or any other channel.",
    pl: "Przechowuj szablony odpowiedzi i powiadomień. Dodawaj, edytuj i usuwaj szablony. Kliknij Kopiuj — tekst gotowy do wysłania przez Telegram lub inny kanał.",
  },
  keywords: {
    ru: ["шаблоны", "сообщения", "текст", "copy", "уведомления"],
    ua: ["шаблони", "повідомлення", "текст", "copy", "сповіщення"],
    en: ["templates", "messages", "text", "copy", "notifications"],
    pl: ["szablony", "wiadomości", "tekst", "kopiowanie", "powiadomienia"],
  },
  availableForRoles: ["master", "tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {
    settingsPanel: {
      sectionKey: "plugin:message-templates",
      componentId: "plugin:message-templates:settings",
    },
  },
  lifecycle: {},
};

export default manifest;
