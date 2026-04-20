import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "keyboard-shortcuts",
  version: "0.2.0",
  vendor: "manicbot",
  category: "productivity",
  status: "beta",
  scope: "both",
  icon: { name: "KeySquare", tint: "#64748b" },
  name: {
    ru: "Горячие клавиши",
    ua: "Гарячі клавіші",
    en: "Keyboard Shortcuts",
    pl: "Skróty klawiaturowe",
  },
  tagline: {
    ru: "Vim-style g-g, g-t навигация",
    ua: "Vim-style g-g, g-t навігація",
    en: "Vim-style g-g, g-t navigation",
    pl: "Nawigacja vim-style g-g, g-t",
  },
  description: {
    ru: "g-g → Dashboard, g-t → Tenants, g-u → Users. ? открывает справку по шорткатам.",
    ua: "g-g → Dashboard, g-t → Tenants, g-u → Users. ? відкриває довідку по шорткатах.",
    en: "g-g → Dashboard, g-t → Tenants, g-u → Users. ? opens cheatsheet.",
    pl: "g-g → Dashboard, g-t → Tenants, g-u → Users. ? otwiera ściągę.",
  },
  keywords: {
    ru: ["горячие клавиши", "shortcuts", "vim", "клавиатура", "hotkeys"],
    ua: ["гарячі клавіші", "shortcuts", "vim", "клавіатура", "hotkeys"],
    en: ["shortcuts", "hotkeys", "vim", "keyboard"],
    pl: ["skróty", "hotkeys", "vim", "klawiatura"],
  },
  availableForRoles: ["system_admin", "tenant_owner", "tenant_manager", "master", "support", "technical_support"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
