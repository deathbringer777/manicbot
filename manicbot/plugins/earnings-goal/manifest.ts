import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "earnings-goal",
  version: "0.2.0",
  vendor: "manicbot",
  category: "productivity",
  status: "beta",
  scope: "tenant",
  icon: { name: "Trophy", tint: "#eab308" },
  name: {
    ru: "Цель по доходу",
    ua: "Ціль по доходу",
    en: "Earnings Goal",
    pl: "Cel zarobkowy",
  },
  tagline: {
    ru: "Прогресс-бар месячной цели",
    ua: "Прогрес-бар місячної цілі",
    en: "Monthly goal progress bar",
    pl: "Pasek postępu miesięcznego celu",
  },
  description: {
    ru: "Установите цель на месяц — виджет показывает прогресс на дашборде мастера.",
    ua: "Встановіть ціль на місяць — віджет показує прогрес на дашборді майстра.",
    en: "Set a monthly goal; widget shows progress on the master's dashboard.",
    pl: "Ustaw cel miesięczny — widget pokazuje postęp na pulpicie mistrza.",
  },
  keywords: {
    ru: ["цель", "доход", "прогресс", "мотивация", "goal"],
    ua: ["ціль", "дохід", "прогрес", "мотивація", "goal"],
    en: ["goal", "earnings", "progress", "motivation", "target"],
    pl: ["cel", "zarobki", "postęp", "motywacja", "target"],
  },
  availableForRoles: ["master"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "appointments.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
