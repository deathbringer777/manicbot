import type { Lang } from "~/lib/i18n";

/** Mirrors manicbot-analysis landing footer: same hrefs and order as i18n footer.links. */
export const PUBLIC_FOOTER_BY_LANG: Record<
  Lang,
  { links: readonly { href: string; label: string }[]; copy: string }
> = {
  ru: {
    links: [
      { href: "/help", label: "Помощь" },
      { href: "/privacy", label: "Конфиденциальность" },
      { href: "/terms", label: "Условия" },
      { href: "/rules", label: "Правила" },
      { href: "/support", label: "Поддержка" },
    ],
    copy: "© 2026 ManicBot. Все права защищены.",
  },
  ua: {
    links: [
      { href: "/help", label: "Довідка" },
      { href: "/privacy", label: "Конфіденційність" },
      { href: "/terms", label: "Умови" },
      { href: "/rules", label: "Правила" },
      { href: "/support", label: "Підтримка" },
    ],
    copy: "© 2026 ManicBot. Всі права захищені.",
  },
  en: {
    links: [
      { href: "/help", label: "Help center" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/rules", label: "Rules" },
      { href: "/support", label: "Support" },
    ],
    copy: "© 2026 ManicBot. All rights reserved.",
  },
  pl: {
    links: [
      { href: "/help", label: "Pomoc" },
      { href: "/privacy", label: "Prywatność" },
      { href: "/terms", label: "Regulamin" },
      { href: "/rules", label: "Zasady" },
      { href: "/support", label: "Wsparcie" },
    ],
    copy: "© 2026 ManicBot. Wszelkie prawa zastrzeżone.",
  },
};
