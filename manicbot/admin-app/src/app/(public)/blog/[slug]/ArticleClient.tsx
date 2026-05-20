"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Calendar, Tag, Clock } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { BLOG_CATEGORY_LABELS } from "~/content/blog/articles";
import type { BlogArticle } from "~/content/blog/types";
import { CATEGORY_STYLE } from "../BlogClient";
import { MarkdownArticle, readingMinutes } from "~/components/public/MarkdownArticle";
import { RelatedArticles } from "~/components/public/RelatedArticles";
import type { Lang } from "~/lib/i18n";

const BACK_LABEL: Record<Lang, string> = {
  ru: "Все статьи",
  ua: "Усі статті",
  en: "All articles",
  pl: "Wszystkie artykuły",
};

const READ_TIME_SUFFIX: Record<Lang, string> = {
  ru: "мин чтения",
  ua: "хв читання",
  en: "min read",
  pl: "min czytania",
};

function formatDate(iso: string, lang: Lang) {
  const d = new Date(iso);
  const locales: Record<Lang, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };
  return d.toLocaleDateString(locales[lang], { day: "numeric", month: "long", year: "numeric" });
}

export function ArticleClient({
  article,
  related,
}: {
  article: BlogArticle;
  related: BlogArticle[];
}) {
  const { lang } = useLang();
  const style = CATEGORY_STYLE[article.categoryKey];
  const body = article.bodies[lang] ?? article.bodies.en ?? article.bodies.ru;
  const mins = readingMinutes(body);

  return (
    <article className="animate-fade-in">
      {/* Hero — raster cover image with gradient overlay and title baked in for narrow viewports */}
      <header className="relative w-full h-56 sm:h-72 md:h-96 overflow-hidden bg-slate-200 dark:bg-slate-800">
        <Image
          src={article.coverImage.url}
          alt={article.coverImage.alt[lang] ?? article.coverImage.alt.en}
          fill
          priority
          sizes="100vw"
          className="object-cover"
          unoptimized
        />
        <div
          className={`pointer-events-none absolute inset-0 bg-gradient-to-t ${style.accent} opacity-80`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40" />
      </header>

      {/* Article body */}
      <div className="mx-auto max-w-3xl px-4 py-8 pb-20">
        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-violet-600 dark:text-white/40 dark:hover:text-violet-400 transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          {BACK_LABEL[lang]}
        </Link>

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.badge}`}
          >
            <Tag className="h-3 w-3" />
            {BLOG_CATEGORY_LABELS[article.categoryKey][lang]}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/30">
            <Calendar className="h-3 w-3" />
            {formatDate(article.date, lang)}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/30">
            <Clock className="h-3 w-3" />
            {mins} {READ_TIME_SUFFIX[lang]}
          </span>
        </div>

        {/* H1 — only one per page, lives below the hero for SEO clarity */}
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-4">
          {article.titles[lang]}
        </h1>

        {/* Excerpt as a lede paragraph */}
        <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 leading-relaxed mb-8 border-l-2 border-violet-300 dark:border-violet-700 pl-4 italic">
          {article.excerpts[lang]}
        </p>

        {/* Markdown body */}
        <MarkdownArticle source={body} />

        {/* Bottom back link */}
        <div className="mt-12 pt-6 border-t border-slate-200 dark:border-white/10">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {BACK_LABEL[lang]}
          </Link>
        </div>

        {/* Related */}
        <RelatedArticles articles={related} />
      </div>
    </article>
  );
}
