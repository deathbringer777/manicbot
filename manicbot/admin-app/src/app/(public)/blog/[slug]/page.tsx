export const runtime = "edge";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BLOG_ARTICLES, CATEGORY_KEYWORDS, pickRelated } from "~/content/blog/articles";
import { ArticleClient } from "./ArticleClient";
import { JsonLd } from "~/components/public/JsonLd";
import {
  buildSeo,
  langToOgLocale,
  articleJsonLd,
  breadcrumbJsonLd,
  SITE_NAME,
} from "~/lib/seo";
import type { Lang } from "~/lib/i18n";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
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

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const [{ slug }, { lang: langRaw }] = await Promise.all([params, searchParams]);
  const article = BLOG_ARTICLES.find((a) => a.slug === slug);
  if (!article) return { title: "404" };
  const lang = pickLang(langRaw);
  const title = article.titles[lang] ?? article.titles.en;
  const description = article.excerpts[lang] ?? article.excerpts.en;
  // Merge per-article keywords with category-level fallbacks; trim to ~10
  // tokens so we don't push past the Google "keyword bag" sweet spot.
  const articleKeywords = article.keywords?.[lang] ?? [];
  const categoryKeywords = CATEGORY_KEYWORDS[article.categoryKey][lang] ?? [];
  const keywords = Array.from(new Set([...articleKeywords, ...categoryKeywords])).slice(0, 10);
  return buildSeo({
    title,
    description,
    path: `/blog/${article.slug}`,
    type: "article",
    publishedTime: article.date,
    modifiedTime: article.updated ?? article.date,
    authors: [SITE_NAME],
    keywords,
    locale: langToOgLocale(langRaw),
    image: article.coverImage.url,
    imageAlt: article.coverImage.alt[lang] ?? article.coverImage.alt.en,
  });
}

export default async function ArticlePage({ params, searchParams }: Props) {
  const [{ slug }, { lang: langRaw }] = await Promise.all([params, searchParams]);
  const article = BLOG_ARTICLES.find((a) => a.slug === slug);
  if (!article) notFound();
  const lang = pickLang(langRaw);
  const title = article.titles[lang] ?? article.titles.en;
  const description = article.excerpts[lang] ?? article.excerpts.en;
  // The `pickRelated` helper is independent of language, so we can compute
  // related slugs in metadata generation if needed later. Currently we surface
  // them client-side in ArticleClient.
  void pickRelated;
  return (
    <>
      <JsonLd
        data={[
          articleJsonLd({
            title,
            description,
            slug: article.slug,
            datePublished: article.date,
            dateModified: article.updated ?? article.date,
            image: article.coverImage.url,
          }),
          breadcrumbJsonLd([
            { name: BREADCRUMB_HOME[lang], path: "/" },
            { name: BREADCRUMB_BLOG[lang], path: "/blog" },
            { name: title, path: `/blog/${article.slug}` },
          ]),
        ]}
      />
      <ArticleClient slug={slug} />
    </>
  );
}
