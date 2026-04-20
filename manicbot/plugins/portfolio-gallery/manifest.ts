import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "portfolio-gallery",
  version: "1.0.0",
  vendor: "manicbot",
  category: "branding",
  status: "live",
  scope: "tenant",
  icon: { name: "Image", tint: "#f43f5e" },
  name: {
    ru: "Портфолио мастера",
    ua: "Портфоліо майстра",
    en: "Portfolio Gallery",
    pl: "Portfolio mistrza",
  },
  tagline: {
    ru: "Публичная страница работ с до/после",
    ua: "Публічна сторінка робіт з до/після",
    en: "Public page with before/after gallery",
    pl: "Publiczna strona prac z przed/po",
  },
  description: {
    ru: "Каждый мастер получает публичный URL с галереей работ. Клиенты выбирают мастера визуально.",
    ua: "Кожен майстер отримує публічний URL з галереєю робіт. Клієнти обирають майстра візуально.",
    en: "Each master gets a public URL with a gallery. Clients pick a master visually.",
    pl: "Każdy mistrz dostaje publiczny URL z galerią. Klienci wybierają mistrza wizualnie.",
  },
  keywords: {
    ru: ["портфолио", "галерея", "работы", "до после", "instagram"],
    ua: ["портфоліо", "галерея", "роботи", "до після", "instagram"],
    en: ["portfolio", "gallery", "work", "before after", "instagram"],
    pl: ["portfolio", "galeria", "prace", "przed po", "instagram"],
  },
  availableForRoles: ["master", "tenant_owner"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "masters.manage", scope: "write" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
