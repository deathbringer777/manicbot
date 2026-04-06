"use client";

import Link from "next/link";
import { ArrowLeft, Calendar, Tag } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { BLOG_ARTICLES, BLOG_CATEGORY_LABELS, type BlogCategory } from "~/content/blog/articles";
import { CATEGORY_STYLE } from "../BlogClient";
import type { Lang } from "~/lib/i18n";

const BACK_LABEL: Record<Lang, string> = {
  ru: "Все статьи",
  ua: "Усі статті",
  en: "All articles",
  pl: "Wszystkie artykuły",
};

function formatDate(iso: string, lang: Lang) {
  const d = new Date(iso);
  const locales: Record<Lang, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };
  return d.toLocaleDateString(locales[lang], { day: "numeric", month: "long", year: "numeric" });
}

export function ArticleClient({ slug }: { slug: string }) {
  const { lang } = useLang();
  const article = BLOG_ARTICLES.find((a) => a.slug === slug);
  if (!article) return null;

  const style = CATEGORY_STYLE[article.categoryKey];

  return (
    <div className="animate-fade-in">
      {/* Cover banner */}
      <div
        className={`relative w-full h-48 sm:h-64 bg-gradient-to-br ${style.gradient} flex items-center justify-center overflow-hidden`}
      >
        <div className="absolute inset-0 opacity-20">
          <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full bg-white/30 blur-3xl" />
          <div className="absolute -bottom-6 -left-6 h-32 w-32 rounded-full bg-black/20 blur-3xl" />
        </div>
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(255,255,255,0.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.8)_1px,transparent_1px)] [background-size:40px_40px]" />
        <span className="relative text-6xl select-none drop-shadow-lg">{style.emoji}</span>
      </div>

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
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-4">
          {article.titles[lang]}
        </h1>

        <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed mb-6 border-l-2 border-violet-300 dark:border-violet-700 pl-4 italic">
          {article.excerpts[lang]}
        </p>

        <div className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
          {article.bodies[lang]}
        </div>

        {/* Bottom back link */}
        <div className="mt-10 pt-6 border-t border-slate-200 dark:border-white/10">
          <Link
            href="/blog"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {BACK_LABEL[lang]}
          </Link>
        </div>
      </div>
    </div>
  );
}
