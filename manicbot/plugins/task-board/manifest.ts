import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "task-board",
  version: "1.0.0",
  vendor: "manicbot",
  category: "productivity",
  status: "live",
  scope: "tenant",
  icon: { name: "LayoutGrid", tint: "#3b82f6" },
  name: {
    ru: "Доска задач",
    ua: "Дошка задач",
    en: "Task Board",
    pl: "Tablica zadań",
  },
  tagline: {
    ru: "Kanban для внутренних дел салона",
    ua: "Kanban для внутрішніх справ салону",
    en: "Kanban board for internal to-dos",
    pl: "Tablica kanban dla zadań wewnętrznych",
  },
  description: {
    ru: "Три колонки: To do / In progress / Done. Назначение на мастеров, сроки, комментарии.",
    ua: "Три колонки: To do / In progress / Done. Призначення на майстрів, терміни, коментарі.",
    en: "Three columns: To do / In progress / Done. Assign to staff, deadlines, comments.",
    pl: "Trzy kolumny: To do / In progress / Done. Przypisanie do personelu, terminy, komentarze.",
  },
  keywords: {
    ru: ["задачи", "kanban", "доска", "todo", "канбан"],
    ua: ["задачі", "kanban", "дошка", "todo", "канбан"],
    en: ["tasks", "kanban", "board", "todo", "workflow"],
    pl: ["zadania", "kanban", "tablica", "todo", "workflow"],
  },
  availableForRoles: ["tenant_manager", "tenant_owner", "master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
