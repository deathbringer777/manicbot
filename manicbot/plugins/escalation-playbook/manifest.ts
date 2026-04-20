import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "escalation-playbook",
  version: "0.1.0",
  vendor: "manicbot",
  category: "operations",
  status: "beta",
  scope: "platform",
  icon: { name: "BookOpen", tint: "#8b5cf6" },
  name: {
    ru: "Инструкции эскалаций",
    ua: "Інструкції ескалацій",
    en: "Escalation Guides",
    pl: "Przewodniki eskalacji",
  },
  tagline: {
    ru: "Когда и кому передавать сложные тикеты",
    ua: "Коли і кому передавати складні тикети",
    en: "When and to whom to hand off tricky tickets",
    pl: "Kiedy i komu przekazywać trudne zgłoszenia",
  },
  description: {
    ru: "Структурированные инструкции: когда эскалировать в engineering, какие данные собирать, кому писать.",
    ua: "Структуровані інструкції: коли ескалювати в engineering, які дані збирати, кому писати.",
    en: "Structured guides: when to escalate to engineering, what data to collect, whom to notify.",
    pl: "Strukturalne instrukcje: kiedy eskalować do engineering, jakie dane zebrać, do kogo pisać.",
  },
  keywords: {
    ru: ["эскалация", "playbook", "runbook", "процедуры", "incidents"],
    ua: ["ескалація", "playbook", "runbook", "процедури", "incidents"],
    en: ["escalation", "playbook", "runbook", "procedures", "incidents"],
    pl: ["eskalacja", "playbook", "runbook", "procedury", "incydenty"],
  },
  availableForRoles: ["support", "technical_support", "system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
