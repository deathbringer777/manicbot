import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BLOG_ARTICLES } from "~/content/blog/articles";
import { ArticleClient } from "./ArticleClient";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = BLOG_ARTICLES.find((a) => a.slug === slug);
  if (!article) return {};
  return {
    title: `${article.titles.en} — ManicBot Blog`,
    description: article.excerpts.en,
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  if (!BLOG_ARTICLES.find((a) => a.slug === slug)) notFound();
  return <ArticleClient slug={slug} />;
}
