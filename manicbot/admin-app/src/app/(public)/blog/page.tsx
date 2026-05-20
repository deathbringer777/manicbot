export const runtime = "edge";

import type { Metadata } from "next";
import { buildSeo, langToOgLocale, breadcrumbJsonLd } from "~/lib/seo";
import { JsonLd } from "~/components/public/JsonLd";
import { BLOG_ARTICLES } from "~/content/blog/articles";
import type { BlogArticle } from "~/content/blog/types";
import type { Lang } from "~/lib/i18n";
import { BlogClient } from "./BlogClient";
import { api } from "~/trpc/server";
import { dtoToArticle } from "~/server/blog/dtoToArticle";

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

// SEO audit 2026-05-20 P1-8 — featured-snippet intro per locale.
// Google extracts featured snippets from the first 40-60 words after the
// page heading. Previously /blog rendered only JSON-LD + the client UI,
// leaving crawlers with no extractable prose. The intro is server-rendered
// and visible (not sr-only) so it's the strongest possible snippet anchor.
const BLOG_INTROS: Record<Lang, string> = {
  pl: "Praktyczny blog dla właścicieli salonów paznokci. Co tydzień nowe artykuły o automatyzacji rezerwacji, AI-recepcjoniście, redukcji no-show, dynamicznym cenniku i kanałach komunikacji (Telegram, Instagram, WhatsApp). Wszystkie poradniki napisane przez praktyków, którzy prowadzili lub obsługują salony beauty.",
  ru: "Практический блог для владельцев nail-салонов и независимых мастеров. Каждую неделю — статьи об автоматизации записи, AI-ресепшене, борьбе с no-show, динамическом ценообразовании и каналах коммуникации (Telegram, Instagram, WhatsApp). Все материалы пишут практики, которые ведут или обслуживают beauty-салоны.",
  ua: "Практичний блог для власників nail-салонів та незалежних майстрів. Щотижня — статті про автоматизацію запису, AI-ресепшен, боротьбу з no-show, динамічне ціноутворення та канали комунікації (Telegram, Instagram, WhatsApp). Всі матеріали пишуть практики, які ведуть або обслуговують beauty-салони.",
  en: "Practical blog for nail salon owners and independent masters. Every week — articles on booking automation, AI receptionist, fighting no-shows, dynamic pricing, and communication channels (Telegram, Instagram, WhatsApp). Every guide written by practitioners who run or serve beauty salons.",
};

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

/**
 * Pull published posts from D1; fall back to the static `BLOG_ARTICLES`
 * during the pre-seed window so the public site keeps rendering even before
 * an admin clicks "Import default articles" on `/system/blog`.
 *
 * Any error from the tRPC call is swallowed and we degrade to the static
 * articles so a transient D1 hiccup doesn't 500 the public page.
 */
async function loadArticles(): Promise<BlogArticle[]> {
  try {
    const dbPosts = await api.blog.listPublic({});
    if (dbPosts.length > 0) return dbPosts.map(dtoToArticle);
  } catch {
    /* fall through */
  }
  return [...BLOG_ARTICLES];
}

/** ItemList of every published article — helps Google render rich blog listings. */
function blogItemListJsonLd(articles: BlogArticle[]) {
  const ordered = [...articles].sort((a, b) => b.date.localeCompare(a.date));
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
  const articles = await loadArticles();
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: BREADCRUMB_HOME[lang], path: "/" },
            { name: BREADCRUMB_BLOG[lang], path: "/blog" },
          ]),
          blogItemListJsonLd(articles),
        ]}
      />
      {/* SEO audit 2026-05-20 P1-8 — SSR intro paragraph for featured snippets.
          Visible to humans AND crawlers without JS. Sits above BlogClient so
          Google extracts from this prose (40-60 words after the heading). */}
      <p
        className="mx-auto max-w-3xl px-4 pt-6 pb-2 text-slate-600 dark:text-slate-300"
        data-ssr-intro
      >
        {BLOG_INTROS[lang]}
      </p>
      <BlogClient articles={articles} />
    </>
  );
}
