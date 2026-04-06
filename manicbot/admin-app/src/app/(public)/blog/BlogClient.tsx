"use client";

import { useMemo, useState } from "react";
import { Calendar, ChevronRight, Tag } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import {
  BLOG_ARTICLES,
  BLOG_CATEGORY_LABELS,
  BLOG_CATEGORY_ORDER,
  type BlogCategory,
} from "~/content/blog/articles";

const UI: Record<
  Lang,
  {
    kicker: string;
    title: string;
    subtitle: string;
    all: string;
    readMore: string;
    collapse: string;
    noResults: string;
  }
> = {
  ru: {
    kicker: "Блог",
    title: "Полезное для салонов",
    subtitle: "Советы, обновления и тренды nail-индустрии",
    all: "Все",
    readMore: "Читать",
    collapse: "Свернуть",
    noResults: "Статей в этой категории пока нет.",
  },
  ua: {
    kicker: "Блог",
    title: "Корисне для салонів",
    subtitle: "Поради, оновлення та тренди nail-індустрії",
    all: "Усі",
    readMore: "Читати",
    collapse: "Згорнути",
    noResults: "Статей у цій категорії поки немає.",
  },
  en: {
    kicker: "Blog",
    title: "Useful for salons",
    subtitle: "Tips, updates and nail industry trends",
    all: "All",
    readMore: "Read",
    collapse: "Collapse",
    noResults: "No articles in this category yet.",
  },
  pl: {
    kicker: "Blog",
    title: "Przydatne dla salonów",
    subtitle: "Porady, aktualizacje i trendy branży nail",
    all: "Wszystkie",
    readMore: "Czytaj",
    collapse: "Zwiń",
    noResults: "Brak artykułów w tej kategorii.",
  },
};

function formatDate(iso: string, lang: Lang) {
  const d = new Date(iso);
  const locales: Record<Lang, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };
  return d.toLocaleDateString(locales[lang], { day: "numeric", month: "long", year: "numeric" });
}

export function BlogClient() {
  const { lang } = useLang();
  const copy = UI[lang] ?? UI.en;
  const [filter, setFilter] = useState<BlogCategory | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const articles = useMemo(() => {
    const sorted = [...BLOG_ARTICLES].sort((a, b) => b.date.localeCompare(a.date));
    if (!filter) return sorted;
    return sorted.filter((a) => a.categoryKey === filter);
  }, [filter]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 pb-20 animate-fade-in">
      {/* Header */}
      <div className="text-center mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400 mb-2">
          {copy.kicker}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {copy.title}
        </h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
          {copy.subtitle}
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
        <button
          type="button"
          onClick={() => setFilter(null)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
            filter === null
              ? "bg-violet-600 text-white shadow-md shadow-violet-500/25"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-white/60 dark:hover:bg-white/[0.1]"
          }`}
        >
          {copy.all}
        </button>
        {BLOG_CATEGORY_ORDER.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ${
              filter === cat
                ? "bg-violet-600 text-white shadow-md shadow-violet-500/25"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-white/60 dark:hover:bg-white/[0.1]"
            }`}
          >
            {BLOG_CATEGORY_LABELS[cat][lang]}
          </button>
        ))}
      </div>

      {/* Articles */}
      {articles.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
          {copy.noResults}
        </p>
      ) : (
        <div className="space-y-5">
          {articles.map((article) => {
            const isOpen = openSlug === article.slug;
            return (
              <article
                key={article.slug}
                id={`blog-${article.slug}`}
                className="rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md dark:border-white/[0.08] dark:bg-slate-900/50 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenSlug(isOpen ? null : article.slug)}
                  className="w-full px-5 py-5 text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                          <Tag className="h-3 w-3" />
                          {BLOG_CATEGORY_LABELS[article.categoryKey][lang]}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-white/30">
                          <Calendar className="h-3 w-3" />
                          {formatDate(article.date, lang)}
                        </span>
                      </div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">
                        {article.titles[lang]}
                      </h2>
                      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                        {article.excerpts[lang]}
                      </p>
                    </div>
                    <ChevronRight
                      className={`mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 px-5 pb-5 pt-4 dark:border-white/[0.06] animate-fade-in">
                    <div className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                      <div className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        {article.bodies[lang]}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenSlug(null)}
                      className="mt-4 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400 transition-colors"
                    >
                      {copy.collapse}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
