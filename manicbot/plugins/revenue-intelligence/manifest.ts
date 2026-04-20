import type { PluginManifest } from "../types";

const manifest: PluginManifest = {
  slug: "revenue-intelligence",
  version: "0.1.0",
  vendor: "manicbot",
  category: "finance",
  status: "beta",
  scope: "platform",
  icon: { name: "TrendingUp", tint: "#10b981" },
  name: {
    ru: "Аналитика выручки",
    ua: "Аналітика виручки",
    en: "Revenue Insights",
    pl: "Analityka przychodów",
  },
  tagline: {
    ru: "Рост, отток и прогноз ценности подписчиков",
    ua: "Зростання, відтік і прогноз цінності підписників",
    en: "Growth, churn, and subscriber lifetime value",
    pl: "Wzrost, odpływ i wartość subskrybentów",
  },
  description: {
    ru: "Декомпозиция MRR по когортам, прогноз оттока, LTV по тарифам и сегментам.",
    ua: "Декомпозиція MRR по когортах, прогноз відтоку, LTV по тарифах і сегментах.",
    en: "MRR breakdown by cohort, churn forecast, LTV per plan and segment.",
    pl: "Dekompozycja MRR według kohort, prognoza odpływu, LTV według planu i segmentu.",
  },
  keywords: {
    ru: ["MRR", "churn", "LTV", "выручка", "финансы", "подписки"],
    ua: ["MRR", "churn", "LTV", "виручка", "фінанси", "підписки"],
    en: ["mrr", "churn", "ltv", "revenue", "finance", "subscriptions"],
    pl: ["mrr", "churn", "ltv", "przychód", "finanse", "subskrypcje"],
  },
  availableForRoles: ["system_admin"],
  minPlan: "any",
  billing: { model: "free" },
  permissions: [{ key: "billing.read", scope: "read" }],
  capabilities: {},
  lifecycle: {},
};

export default manifest;
