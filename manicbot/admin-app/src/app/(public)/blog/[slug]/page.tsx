export const runtime = "edge";

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BLOG_ARTICLES, CATEGORY_KEYWORDS, pickRelated } from "~/content/blog/articles";
import type { BlogArticle } from "~/content/blog/types";
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
import { api } from "~/trpc/server";
import { dtoToArticle } from "~/server/blog/dtoToArticle";

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

/**
 * Look up the article by slug:
 *   1. Try D1 (`blog.getPublic` returns only `status='published'` rows).
 *   2. Fall back to the legacy static `BLOG_ARTICLES` so a slug published
 *      pre-seed keeps resolving.
 * Returns the article along with the full list (for the `pickRelated` helper).
 */
async function loadArticleBundle(slug: string): Promise<{
  article: BlogArticle | null;
  all: BlogArticle[];
}> {
  let dbList: BlogArticle[] = [];
  try {
    const rows = await api.blog.listPublic({});
    if (rows.length > 0) dbList = rows.map(dtoToArticle);
  } catch {
    /* fall through to static */
  }
  if (dbList.length > 0) {
    const article = dbList.find((a) => a.slug === slug) ?? null;
    if (article) return { article, all: dbList };
    // DB has posts but not this slug — still try static for safety.
  }
  const staticArticle = BLOG_ARTICLES.find((a) => a.slug === slug) ?? null;
  const all = dbList.length > 0 ? dbList : [...BLOG_ARTICLES];
  return { article: staticArticle ?? null, all };
}

export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const [{ slug }, { lang: langRaw }] = await Promise.all([params, searchParams]);
  const { article } = await loadArticleBundle(slug);
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
  const { article, all } = await loadArticleBundle(slug);
  if (!article) notFound();
  const lang = pickLang(langRaw);
  const title = article.titles[lang] ?? article.titles.en;
  const description = article.excerpts[lang] ?? article.excerpts.en;
  const related = pickRelated(article, all);
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
      <ArticleClient article={article} related={related} />
    </>
  );
}
