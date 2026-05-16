export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale, breadcrumbJsonLd } from "~/lib/seo";
import { JsonLd } from "~/components/public/JsonLd";
import { BLOG_ARTICLES } from "~/content/blog/articles";
import type { Lang } from "~/lib/i18n";
import { BlogClient } from "./BlogClient";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

const TITLES: Record<Lang, string> = {
  ru: "Блог — автоматизация nail-салона, AI и тренды 2026",
  ua: "Блог — автоматизація nail-салону, AI та тренди 2026",
  en: "Blog — nail salon automation, AI, and 2026 trends",
  pl: "Blog — automatyzacja salonu paznokci, AI i trendy 2026",
};

const DESCRIPTIONS: Record<Lang, string> = {
  ru: "Советы по автоматизации nail-салона: AI-ресепшен 24/7, динамическое ценообразование, омниканальный inbox, борьба с no-show, тренды бьюти-индустрии и обновления ManicBot.",
  ua: "Поради з автоматизації nail-салону: AI-ресепшен 24/7, динамічне ціноутворення, омніканальний inbox, боротьба з no-show, тренди б'юті-індустрії та оновлення ManicBot.",
  en: "Tips on automating a nail salon: 24/7 AI reception, dynamic pricing, omnichannel inbox, fighting no-shows, beauty trends, and ManicBot updates.",
  pl: "Porady o automatyzacji salonu paznokci: recepcja AI 24/7, dynamiczne ceny, skrzynka omnichannel, walka z no-show, trendy beauty i aktualizacje ManicBot.",
};

const KEYWORDS: Record<Lang, string[]> = {
  ru: [
    "блог nail салон",
    "автоматизация салона красоты",
    "AI в салоне",
    "Telegram бот для маникюра",
    "no-show в салоне",
    "тренды бьюти 2026",
  ],
  ua: [
    "блог nail салон",
    "автоматизація салону краси",
    "AI у салоні",
    "Telegram бот для манікюру",
    "no-show у салоні",
    "тренди б'юті 2026",
  ],
  en: [
    "nail salon blog",
    "beauty salon automation",
    "AI in salons",
    "Telegram booking bot",
    "salon no-shows",
    "beauty trends 2026",
  ],
  pl: [
    "blog salon paznokci",
    "automatyzacja salonu urody",
    "AI w salonie",
    "bot Telegram do manicure",
    "no-show w salonie",
    "trendy beauty 2026",
  ],
};

const SUPPORTED: ReadonlyArray<Lang> = ["ru", "ua", "en", "pl"];

function pickLang(raw: string | string[] | undefined): Lang {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return "ru";
  const lc = String(v).toLowerCase();
  if ((SUPPORTED as readonly string[]).includes(lc)) return lc as Lang;
  if (lc === "uk") return "ua";
  return "ru";
}

const BREADCRUMB_HOME: Record<Lang, string> = { ru: "Главная", ua: "Головна", en: "Home", pl: "Strona główna" };
const BREADCRUMB_BLOG: Record<Lang, string> = { ru: "Блог", ua: "Блог", en: "Blog", pl: "Blog" };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return buildSeo({
    title: TITLES[lang],
    description: DESCRIPTIONS[lang],
    path: "/blog",
    keywords: KEYWORDS[lang],
    locale: langToOgLocale(langRaw),
  });
}

/** ItemList of every published article — helps Google render rich blog listings. */
function blogItemListJsonLd() {
  const ordered = [...BLOG_ARTICLES].sort((a, b) => b.date.localeCompare(a.date));
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "ManicBot blog",
    itemListElement: ordered.map((article, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      url: `https://manicbot.com/blog/${article.slug}`,
      name: article.titles.en,
    })),
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const { lang: langRaw } = await searchParams;
  const lang = pickLang(langRaw);
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: BREADCRUMB_HOME[lang], path: "/" },
            { name: BREADCRUMB_BLOG[lang], path: "/blog" },
          ]),
          blogItemListJsonLd(),
        ]}
      />
      <BlogClient />
    </>
  );
}
