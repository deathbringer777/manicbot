import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "client-crm-lite",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "tenant",
  icon: { name: "UserRound", tint: "#06b6d4" },
  name: {
    ru: "Заметки о клиентах",
    ua: "Нотатки про клієнтів",
    en: "Client Notes",
    pl: "Notatki o klientach",
  },
  tagline: {
    ru: "Личные пометки мастера — предпочтения, аллергии",
    ua: "Особисті нотатки майстра — вподобання, алергії",
    en: "Master's private notes — preferences, allergies",
    pl: "Prywatne notatki — preferencje, alergie",
  },
  description: {
    ru: "Заметки, тэги, фото ногтей, последние визиты. Доступно только мастеру, не видно владельцу.",
    ua: "Нотатки, теги, фото нігтів, останні візити. Доступно лише майстру, не бачить власник.",
    en: "Notes, tags, nail photos, last visits. Master-only, hidden from owner.",
    pl: "Notatki, tagi, zdjęcia paznokci, ostatnie wizyty. Widoczne tylko dla mistrza.",
  },
  keywords: {
    ru: ["crm", "заметки", "клиенты", "теги", "история"],
    ua: ["crm", "нотатки", "клієнти", "теги", "історія"],
    en: ["crm", "notes", "clients", "tags", "history"],
    pl: ["crm", "notatki", "klienci", "tagi", "historia"],
  },
  availableForRoles: ["master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "clients.view", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
