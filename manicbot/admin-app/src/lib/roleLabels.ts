import type { Lang } from "./i18n";

const ROLE_LABELS: Record<string, Record<Lang, string>> = {
  tenant_owner: {
    ru: "Владелец салона",
    ua: "Власник салону",
    en: "Salon Owner",
    pl: "Właściciel salonu",
  },
  master: {
    ru: "Мастер",
    ua: "Майстер",
    en: "Master",
    pl: "Mistrz",
  },
  support: {
    ru: "Поддержка",
    ua: "Підтримка",
    en: "Support",
    pl: "Wsparcie",
  },
  technical_support: {
    ru: "Тех. поддержка",
    ua: "Тех. підтримка",
    en: "Tech Support",
    pl: "Wsparcie tech.",
  },
  system_admin: {
    ru: "Администратор",
    ua: "Адміністратор",
    en: "Administrator",
    pl: "Administrator",
  },
};

export function friendlyRoleName(role: string | null | undefined, lang: Lang): string {
  if (!role) return "—";
  return ROLE_LABELS[role]?.[lang] ?? role;
}
