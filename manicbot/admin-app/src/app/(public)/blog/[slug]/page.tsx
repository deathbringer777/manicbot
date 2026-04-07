import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BLOG_ARTICLES } from "~/content/blog/articles";
import { ArticleClient } from "./ArticleClient";
import { JsonLd } from "~/components/public/JsonLd";
import {
  buildSeo,
  articleJsonLd,
  breadcrumbJsonLd,
  SITE_NAME,
} from "~/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = BLOG_ARTICLES.find((a) => a.slug === slug);
  if (!article) return { title: `Статья не найдена — ${SITE_NAME}` };
  return buildSeo({
    title: article.titles.ru,
    description: article.excerpts.ru,
    path: `/blog/${article.slug}`,
    type: "article",
    publishedTime: article.date,
    modifiedTime: article.date,
    authors: [SITE_NAME],
    keywords: [article.titles.ru, "nail салон", "автоматизация", "ManicBot блог"],
  });
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = BLOG_ARTICLES.find((a) => a.slug === slug);
  if (!article) notFound();
  return (
    <>
      <JsonLd
        data={[
          articleJsonLd({
            title: article.titles.ru,
            description: article.excerpts.ru,
            slug: article.slug,
            datePublished: article.date,
          }),
          breadcrumbJsonLd([
            { name: "Главная", path: "/" },
            { name: "Блог", path: "/blog" },
            { name: article.titles.ru, path: `/blog/${article.slug}` },
          ]),
        ]}
      />
      <ArticleClient slug={slug} />
    </>
  );
}
