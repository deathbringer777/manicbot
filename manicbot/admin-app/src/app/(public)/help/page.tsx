export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale } from "~/lib/seo";
import { JsonLd } from "~/components/public/JsonLd";
import { HelpCenterClient } from "./HelpCenterClient";
import { HELP_FAQS } from "~/content/help/articles";
import type { Lang } from "~/lib/i18n";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

const SUPPORTED: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];

function pickLang(raw: string | string[] | undefined): Lang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "pl";
  const lc = String(v).toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(lc)) return lc as Lang;
  if (lc === "uk") return "ua";
  return "pl";
}

// SEO audit 2026-05-20 P1-10 — title/H1 locale parity.
//
// Previously the title was hardcoded Russian ("Справочный центр") while
// the H1 inside HelpCenterClient is Polish ("Poradniki i odpowiedzi").
// Inconsistent locale signals confuse Google's language detection and
// hurt the page's ranking in EVERY locale. Now title + description +
// keywords are localized per requested `lang` to match the rendered H1.
const HELP_TITLES: Record<Lang, string> = {
  pl: "Poradniki i odpowiedzi",
  ru: "Справочный центр",
  ua: "Довідковий центр",
  en: "Help center",
};

const HELP_DESCRIPTIONS: Record<Lang, string> = {
  pl: "Instrukcje pracy z ManicBot: jak utworzyć rezerwację, zarządzać usługami i mistrzami, skonfigurować kanały WhatsApp i Instagram, podłączyć Google Calendar i otrzymać wsparcie.",
  ru: "Инструкции по работе с ManicBot: как создать запись, управлять услугами и мастерами, настроить каналы WhatsApp и Instagram, подключить Google Calendar и получить поддержку.",
  ua: "Інструкції з роботи з ManicBot: як створити запис, керувати послугами і майстрами, налаштувати канали WhatsApp і Instagram, підключити Google Calendar і отримати підтримку.",
  en: "Working with ManicBot: how to create a booking, manage services and masters, configure WhatsApp and Instagram channels, connect Google Calendar and get support.",
};

const HELP_KEYWORDS: Record<Lang, string[]> = {
  pl: ["ManicBot pomoc", "jak zarezerwować w salonie", "instrukcja salon paznokci", "wsparcie", "FAQ ManicBot"],
  ru: ["ManicBot помощь", "как записаться в салон", "инструкция салон красоты", "поддержка", "FAQ ManicBot"],
  ua: ["ManicBot допомога", "як записатися в салон", "інструкція салон краси", "підтримка", "FAQ ManicBot"],
  en: ["ManicBot help", "how to book a salon", "nail salon guide", "support", "ManicBot FAQ"],
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return buildSeo({
    title: HELP_TITLES[lang],
    description: HELP_DESCRIPTIONS[lang],
    path: "/help",
    keywords: HELP_KEYWORDS[lang],
    locale: langToOgLocale(langRaw),
  });
}

/**
 * SEO audit 2026-05-20 P1-9 — FAQ schema.
 *
 * The help center already ships rich Q&A content (HELP_FAQS, 8+ pairs).
 * Surfacing it as `FAQPage` JSON-LD unlocks Google's FAQ rich-result
 * snippet — free SERP real-estate. We cap to top 10 questions so the
 * payload stays under the rich-result quality bar.
 */
function helpFaqJsonLd(lang: Lang) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: HELP_FAQS.slice(0, 10).map((f) => ({
      "@type": "Question",
      name: f.questions[lang] ?? f.questions.en,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answers[lang] ?? f.answers.en,
      },
    })),
  };
}

export default async function HelpPage({ searchParams }: Props) {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return (
    <>
      <JsonLd data={helpFaqJsonLd(lang)} />
      <HelpCenterClient />
    </>
  );
}
