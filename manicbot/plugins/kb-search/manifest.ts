import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "kb-search",
  version: "0.1.0",
  vendor: "manicbot",
  category: "productivity",
  status: "beta",
  scope: "platform",
  icon: { name: "Search", tint: "#06b6d4" },
  name: {
    ru: "Поиск по решённым тикетам",
    ua: "Пошук по вирішених тикетах",
    en: "Resolved Ticket Search",
    pl: "Wyszukiwanie w rozwiązanych zgłoszeniach",
  },
  tagline: {
    ru: "Найдите как коллега уже решал похожий случай",
    ua: "Знайдіть, як колега вже вирішував схожий випадок",
    en: "Find how a teammate already solved a similar case",
    pl: "Zobacz jak kolega rozwiązał podobną sprawę",
  },
  description: {
    ru: "Быстрый fuzzy-поиск по всем закрытым тикетам. Найти как коллега уже решал похожий кейс.",
    ua: "Швидкий fuzzy-пошук по всіх закритих тикетах. Знайти як колега вже вирішував схожий кейс.",
    en: "Fast fuzzy search across every resolved ticket. Find how a teammate already handled it.",
    pl: "Szybkie fuzzy-wyszukiwanie wśród zamkniętych zgłoszeń. Zobacz, jak kolega to rozwiązał.",
  },
  keywords: {
    ru: ["поиск", "база знаний", "тикеты", "история", "search"],
    ua: ["пошук", "база знань", "тикети", "історія", "search"],
    en: ["search", "knowledge base", "tickets", "history", "kb"],
    pl: ["wyszukiwanie", "baza wiedzy", "zgłoszenia", "historia", "kb"],
  },
  availableForRoles: ["support", "technical_support", "system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "tickets.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
