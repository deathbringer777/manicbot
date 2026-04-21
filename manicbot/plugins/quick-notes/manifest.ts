import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "quick-notes",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "both",
  icon: { name: "StickyNote", tint: "#f59e0b" },
  name: {
    ru: "Быстрые заметки",
    ua: "Швидкі нотатки",
    en: "Quick Notes",
    pl: "Szybkie notatki",
  },
  tagline: {
    ru: "Записывайте идеи и важные детали прямо в панели",
    ua: "Записуйте ідеї та важливі деталі прямо в панелі",
    en: "Capture ideas and important details right in the panel",
    pl: "Zapisuj pomysły i ważne szczegóły bezpośrednio w panelu",
  },
  description: {
    ru: "Простой блокнот внутри панели управления. До 50 заметок, поддержка редактирования и удаления. Данные хранятся локально в браузере.",
    ua: "Простий блокнот всередині панелі управління. До 50 нотаток, підтримка редагування та видалення. Дані зберігаються локально в браузері.",
    en: "A simple notepad inside the control panel. Up to 50 notes with editing and deletion support. Data stored locally in the browser.",
    pl: "Prosty notatnik wewnątrz panelu sterowania. Do 50 notatek z obsługą edytowania i usuwania. Dane przechowywane lokalnie w przeglądarce.",
  },
  keywords: {
    ru: ["заметки", "блокнот", "записи", "идеи", "notes"],
    ua: ["нотатки", "блокнот", "записи", "ідеї", "notes"],
    en: ["notes", "notepad", "ideas", "quick", "memo"],
    pl: ["notatki", "notatnik", "pomysły", "szybkie", "memo"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "tenant_manager", "master", "support", "technical_support"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {
    settingsPanel: {
      sectionKey: "plugin:quick-notes",
      componentId: "plugin:quick-notes:settings",
    },
  },
  lifecycle: {},
};

export default manifest;
