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
    ru: "Бот на 4 языках",
    ua: "Бот 4 мовами",
    en: "Multilingual Bot",
    pl: "Bot w 4 językach",
  },
  tagline: {
    ru: "Клиент пишет на своём — бот отвечает так же",
    ua: "Клієнт пише своєю — бот відповідає так само",
    en: "Client writes in their language — bot replies the same way",
    pl: "Klient pisze w swoim języku — bot odpowiada tak samo",
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
