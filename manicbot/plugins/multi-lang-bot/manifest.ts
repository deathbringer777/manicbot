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
    ru: "Многоязычный бот",
    ua: "Багатомовний бот",
    en: "Multi-Language Bot",
    pl: "Bot wielojęzyczny",
  },
  tagline: {
    ru: "Авто-распознавание языка клиента",
    ua: "Авто-розпізнавання мови клієнта",
    en: "Auto-detects client's language",
    pl: "Wykrywa język klienta automatycznie",
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
