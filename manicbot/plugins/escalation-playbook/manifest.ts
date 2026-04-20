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
    ru: "Playbook эскалаций",
    ua: "Playbook ескалацій",
    en: "Escalation Playbook",
    pl: "Playbook eskalacji",
  },
  tagline: {
    ru: "Runbook-и по типам тикетов",
    ua: "Runbook-и по типах тикетів",
    en: "Runbooks by ticket type",
    pl: "Runbooki wg typu zgłoszenia",
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
