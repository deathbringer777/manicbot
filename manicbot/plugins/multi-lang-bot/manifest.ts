import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "multi-lang-bot",
  version: "0.1.0",
  vendor: "manicbot",
  category: "communication",
  status: "beta",
  scope: "tenant",
  icon: { name: "Globe", tint: "#06b6d4" },
  name: {
    ru: "Автоопределение языка",
    ua: "Автовизначення мови",
    en: "Auto Language Detection",
    pl: "Automatyczne wykrywanie języka",
  },
  tagline: {
    ru: "Бот автоматически определяет язык клиента и отвечает на нём же",
    ua: "Бот автоматично визначає мову клієнта та відповідає тією ж мовою",
    en: "Bot automatically detects the client's language and responds in the same language",
    pl: "Bot automatycznie wykrywa język klienta i odpowiada w tym samym języku",
  },
  description: {
    ru: "Бот отвечает клиенту на его языке (ru/ua/en/pl) на основе Telegram lang_code или первого сообщения.",
    ua: "Бот відповідає клієнту його мовою (ru/ua/en/pl) на основі Telegram lang_code або першого повідомлення.",
    en: "Bot replies in the client's language (ru/ua/en/pl) based on Telegram lang_code or first message.",
    pl: "Bot odpowiada w języku klienta (ru/ua/en/pl) na podstawie Telegram lang_code lub pierwszej wiadomości.",
  },
  keywords: {
    ru: ["язык", "мультиязычный", "локализация", "i18n"],
    ua: ["мова", "мультимовний", "локалізація", "i18n"],
    en: ["language", "multilingual", "localization", "i18n"],
    pl: ["język", "wielojęzyczny", "lokalizacja", "i18n"],
  },
  availableForRoles: ["tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "settings.manage", scope: "write", sensitive: true }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
