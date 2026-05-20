export const runtime = "edge";

import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "~/components/public/JsonLd";
import { buildSeo, breadcrumbJsonLd, langToOgLocale } from "~/lib/seo";
import { COMPARISONS } from "~/content/comparisons/data";
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

const TITLES: Record<Lang, string> = {
  pl: "Porównania ManicBot vs konkurencja — Booksy, Fresha, Yclients, Versum",
  ru: "Сравнения ManicBot и конкурентов — Booksy, Fresha, Yclients, Versum",
  ua: "Порівняння ManicBot і конкурентів — Booksy, Fresha, Yclients, Versum",
  en: "ManicBot vs competitors — Booksy, Fresha, Yclients, Versum compared",
};

const DESCRIPTIONS: Record<Lang, string> = {
  pl: "Szczegółowe porównania ManicBot z głównymi platformami booking dla salonów: Booksy, Fresha, Yclients i Versum. Ceny, kanały, prowizje i funkcje AI w jednym miejscu.",
  ru: "Подробные сравнения ManicBot с основными booking-платформами для салонов: Booksy, Fresha, Yclients и Versum. Цены, каналы, комиссии и AI-функции в одном месте.",
  ua: "Детальні порівняння ManicBot з основними booking-платформами для салонів: Booksy, Fresha, Yclients і Versum. Ціни, канали, комісії та AI-функції в одному місці.",
  en: "Detailed comparisons of ManicBot against the major salon booking platforms: Booksy, Fresha, Yclients, and Versum. Pricing, channels, commissions, and AI features in one place.",
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return buildSeo({
    title: TITLES[lang],
    description: DESCRIPTIONS[lang],
    path: "/comparisons",
    keywords: [
      "Booksy alternatywa", "альтернатива Booksy",
      "Fresha alternative", "Yclients alternative",
      "porównanie booking salonu",
      "сравнение booking платформ",
    ],
    locale: langToOgLocale(langRaw),
  });
}

const H1: Record<Lang, string> = {
  pl: "Porównanie ManicBot vs konkurencja",
  ru: "Сравнение ManicBot и конкурентов",
  ua: "Порівняння ManicBot і конкурентів",
  en: "ManicBot vs the competition",
};

const INTRO: Record<Lang, string> = {
  pl: "Wybór platformy booking dla salonu paznokci to długoterminowa decyzja. Tu zebraliśmy szczegółowe porównania z czterema głównymi konkurentami — z prawdziwymi cenami, prowizjami, listą obsługiwanych kanałów i siedzibą firmy. Ceny zweryfikowane w maju 2026.",
  ru: "Выбор booking-платформы для nail-салона — долгосрочное решение. Тут собраны подробные сравнения с четырьмя главными конкурентами — с реальными ценами, комиссиями, списком каналов и юрисдикцией. Цены проверены в мае 2026.",
  ua: "Вибір booking-платформи для nail-салону — довгострокове рішення. Тут зібрано детальні порівняння з чотирма головними конкурентами — з реальними цінами, комісіями, переліком каналів та юрисдикцією. Ціни перевірено у травні 2026.",
  en: "Choosing a booking platform for your nail salon is a long-term decision. Here are detailed comparisons against the four major competitors — with real prices, commissions, supported channels, and HQ details. Pricing verified May 2026.",
};

export default async function ComparisonsIndexPage({ searchParams }: Props) {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: TITLES[lang],
    numberOfItems: COMPARISONS.length,
    itemListElement: COMPARISONS.map((c, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: `https://manicbot.com/comparisons/${c.slug}`,
      name: `ManicBot vs ${c.competitorName}`,
    })),
  };
  return (
    <>
      <JsonLd
        data={[
          itemListJsonLd,
          breadcrumbJsonLd([
            { name: lang === "pl" ? "Strona główna" : lang === "ru" ? "Главная" : lang === "ua" ? "Головна" : "Home", path: "/" },
            { name: lang === "pl" ? "Porównania" : lang === "ru" ? "Сравнения" : lang === "ua" ? "Порівняння" : "Comparisons", path: "/comparisons" },
          ]),
        ]}
      />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <header className="mb-10">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white sm:text-5xl">
            {H1[lang]}
          </h1>
          <p className="mt-4 text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
            {INTRO[lang]}
          </p>
        </header>
        <ul className="grid gap-4 sm:grid-cols-2">
          {COMPARISONS.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/comparisons/${c.slug}`}
                className="block rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-violet-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  ManicBot vs {c.competitorName}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{c.competitorEstablished}</p>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 line-clamp-4">
                  {c.heroSummary[lang]}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
