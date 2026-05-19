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

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang } = await searchParams;
  return buildSeo({
    title: "Справочный центр",
    description:
      "Инструкции по работе с ManicBot: как создать запись, управлять услугами и мастерами, настроить каналы WhatsApp и Instagram, подключить Google Calendar и получить поддержку.",
    path: "/help",
    keywords: [
      "ManicBot помощь",
      "как записаться в салон",
      "инструкция салон красоты",
      "поддержка",
      "FAQ ManicBot",
    ],
    locale: langToOgLocale(lang),
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
