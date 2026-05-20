export const runtime = "edge";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "~/components/public/JsonLd";
import { buildSeo, breadcrumbJsonLd, langToOgLocale, SITE_URL } from "~/lib/seo";
import { COMPARISONS, findComparison, type ComparisonPage } from "~/content/comparisons/data";
import type { Lang } from "~/lib/i18n";

type Props = {
  params: Promise<{ competitor: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
};

const SUPPORTED: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];

function pickLang(raw: string | string[] | undefined): Lang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "pl";
  const lc = String(v).toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(lc)) return lc as Lang;
  if (lc === "uk") return "ua";
  return "pl";
}

// Build-time: Next.js edge runtime cannot use generateStaticParams. The
// dynamic route is server-rendered on each request via Cloudflare Pages.
// The allowlist is `findComparison(competitor)` — any slug NOT in the
// COMPARISONS array hits `notFound()` and returns 404.

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ competitor }, { lang: langRaw }] = await Promise.all([params, searchParams]);
  const data = findComparison(competitor);
  if (!data) return { title: "Comparison not found", robots: { index: false, follow: false } };
  const lang = pickLang(langRaw);
  const titleByLang: Record<Lang, string> = {
    pl: `ManicBot vs ${data.competitorName} — porównanie cen, kanałów i AI (2026)`,
    ru: `ManicBot vs ${data.competitorName} — сравнение цен, каналов и AI (2026)`,
    ua: `ManicBot vs ${data.competitorName} — порівняння цін, каналів та AI (2026)`,
    en: `ManicBot vs ${data.competitorName} — pricing, channels & AI compared (2026)`,
  };
  return buildSeo({
    title: titleByLang[lang],
    description: data.heroSummary[lang],
    path: `/comparisons/${data.slug}`,
    keywords: [
      `ManicBot vs ${data.competitorName}`,
      `${data.competitorName} alternatywa`,
      `${data.competitorName} альтернатива`,
      `${data.competitorName} alternative`,
      "salon paznokci software",
      "программа для салона маникюра",
    ],
    locale: langToOgLocale(langRaw),
  });
}

const HEADINGS: Record<Lang, { tldr: string; sideBySide: string; whyHeading: string; faqHeading: string; cta: string; founded: string; pricingFootnote: string; pricingFootnoteVerified: string }> = {
  pl: {
    tldr: "TL;DR",
    sideBySide: "Porównanie funkcji",
    whyHeading: "Dlaczego ManicBot wygrywa",
    faqHeading: "Najczęściej zadawane pytania",
    cta: "Zacznij 14-dniowy okres próbny",
    founded: "Rok założenia",
    pricingFootnote: "Ceny konkurenta na podstawie publicznych źródeł — zweryfikuj przed podjęciem decyzji",
    pricingFootnoteVerified: "Ceny konkurenta zweryfikowane na oficjalnej stronie cenowej (maj 2026)",
  },
  ru: {
    tldr: "TL;DR",
    sideBySide: "Сравнение функций",
    whyHeading: "Почему ManicBot выигрывает",
    faqHeading: "Часто задаваемые вопросы",
    cta: "Начать 14-дневный триал",
    founded: "Год основания",
    pricingFootnote: "Цены конкурента из публичных источников — проверьте перед принятием решения",
    pricingFootnoteVerified: "Цены конкурента подтверждены на официальной странице цен (май 2026)",
  },
  ua: {
    tldr: "TL;DR",
    sideBySide: "Порівняння функцій",
    whyHeading: "Чому ManicBot виграє",
    faqHeading: "Часто задавані питання",
    cta: "Почати 14-денну пробну версію",
    founded: "Рік заснування",
    pricingFootnote: "Ціни конкурента з публічних джерел — перевірте перед прийняттям рішення",
    pricingFootnoteVerified: "Ціни конкурента підтверджено на офіційній сторінці цін (травень 2026)",
  },
  en: {
    tldr: "TL;DR",
    sideBySide: "Feature comparison",
    whyHeading: "Why ManicBot wins",
    faqHeading: "Frequently asked questions",
    cta: "Start 14-day free trial",
    founded: "Founded",
    pricingFootnote: "Competitor pricing from public sources — verify before making a decision",
    pricingFootnoteVerified: "Competitor pricing verified on the official pricing page (May 2026)",
  },
};

function comparisonProductJsonLd(data: ComparisonPage, lang: Lang) {
  // SoftwareApplication for ManicBot referenced by @id (declared on /).
  // ProductComparison schema doesn't exist as a recognized type yet, so we
  // ship a CollectionPage with mentions to keep crawlers happy.
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `ManicBot vs ${data.competitorName}`,
    url: `${SITE_URL}/comparisons/${data.slug}`,
    description: data.heroSummary[lang],
    mainEntity: {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "ManicBot",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: [
        { "@type": "Offer", name: "Start", price: "45", priceCurrency: "PLN" },
        { "@type": "Offer", name: "Pro",   price: "60", priceCurrency: "PLN" },
        { "@type": "Offer", name: "Max",   price: "90", priceCurrency: "PLN" },
      ],
    },
    about: { "@type": "SoftwareApplication", name: data.competitorName },
  };
}

function comparisonFaqJsonLd(data: ComparisonPage, lang: Lang) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faqs[lang].map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export default async function ComparisonPage({ params, searchParams }: Props) {
  const [{ competitor }, { lang: langRaw }] = await Promise.all([params, searchParams]);
  const data = findComparison(competitor);
  if (!data) notFound();
  const lang = pickLang(langRaw);
  const h = HEADINGS[lang];

  return (
    <>
      <JsonLd
        data={[
          comparisonProductJsonLd(data, lang),
          comparisonFaqJsonLd(data, lang),
          breadcrumbJsonLd([
            { name: lang === "pl" ? "Strona główna" : lang === "ru" ? "Главная" : lang === "ua" ? "Головна" : "Home", path: "/" },
            { name: lang === "pl" ? "Porównania" : lang === "ru" ? "Сравнения" : lang === "ua" ? "Порівняння" : "Comparisons", path: "/comparisons" },
            { name: `ManicBot vs ${data.competitorName}`, path: `/comparisons/${data.slug}` },
          ]),
        ]}
      />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <header className="mb-10">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {h.founded}: {data.competitorEstablished}
          </p>
          <h1 className="mt-2 text-4xl font-bold text-slate-900 dark:text-white sm:text-5xl">
            ManicBot vs {data.competitorName}
          </h1>
        </header>

        <section className="mb-10 rounded-2xl border border-violet-200 bg-violet-50 p-6 dark:border-violet-900/50 dark:bg-violet-950/30">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            {h.tldr}
          </h2>
          <p className="mt-2 text-lg leading-relaxed text-slate-700 dark:text-slate-200">
            {data.heroSummary[lang]}
          </p>
        </section>

        <section className="mb-12" aria-labelledby="cmp-table-heading">
          <h2
            id="cmp-table-heading"
            className="text-2xl font-bold text-slate-900 dark:text-white mb-4"
          >
            {h.sideBySide}
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">&nbsp;</th>
                  <th className="px-4 py-3 text-sm font-semibold text-violet-700 dark:text-violet-300">ManicBot</th>
                  <th className="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {data.competitorName}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                {data.rows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                      {row.label[lang]}
                    </td>
                    <td className={`px-4 py-3 text-sm ${row.winnerLeft ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}>
                      {row.manicbot}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
                      {row.competitor}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {data.pricingVerifiedManual ? h.pricingFootnoteVerified : h.pricingFootnote}
            {" · "}
            <a href={data.pricingSourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {lang === "pl" ? "Źródło" : lang === "ru" ? "Источник" : lang === "ua" ? "Джерело" : "Source"}
            </a>
          </p>
        </section>

        <section className="mb-12" aria-labelledby="why-manicbot-heading">
          <h2 id="why-manicbot-heading" className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
            {h.whyHeading}
          </h2>
          <ul className="space-y-3">
            {data.whyManicbot[lang].map((reason, idx) => (
              <li
                key={idx}
                className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="text-emerald-500 font-bold" aria-hidden="true">✓</span>
                <span className="text-slate-700 dark:text-slate-300">{reason}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-12" aria-labelledby="cmp-faq-heading">
          <h2
            id="cmp-faq-heading"
            className="text-2xl font-bold text-slate-900 dark:text-white mb-4"
          >
            {h.faqHeading}
          </h2>
          <div className="space-y-3">
            {data.faqs[lang].map((faq, idx) => (
              <details
                key={idx}
                className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">
                  {faq.q}
                </summary>
                <p className="mt-3 text-slate-600 dark:text-slate-300 leading-relaxed">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="text-center">
          <Link
            href="/register"
            className="inline-flex h-12 items-center rounded-lg bg-violet-600 px-6 font-semibold text-white hover:bg-violet-700"
          >
            {h.cta}
          </Link>
        </section>
      </main>
    </>
  );
}
