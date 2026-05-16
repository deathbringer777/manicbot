"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Calendar, Tag } from "lucide-react";
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
  { kicker: string; title: string; subtitle: string; all: string; readMore: string; noResults: string }
> = {
  ru: {
    kicker: "Блог",
    title: "Полезное для салонов",
    subtitle: "Советы, обновления и тренды nail-индустрии",
    all: "Все",
    readMore: "Читать →",
    noResults: "Статей в этой категории пока нет.",
  },
  ua: {
    kicker: "Блог",
    title: "Корисне для салонів",
    subtitle: "Поради, оновлення та тренди nail-індустрії",
    all: "Усі",
    readMore: "Читати →",
    noResults: "Статей у цій категорії поки немає.",
  },
  en: {
    kicker: "Blog",
    title: "Useful for salons",
    subtitle: "Tips, updates and nail industry trends",
    all: "All",
    readMore: "Read →",
    noResults: "No articles in this category yet.",
  },
  pl: {
    kicker: "Blog",
    title: "Przydatne dla salonów",
    subtitle: "Porady, aktualizacje i trendy branży nail",
    all: "Wszystkie",
    readMore: "Czytaj →",
    noResults: "Brak artykułów w tej kategorii.",
  },
};

/** Category-specific styling used for tag badges across the blog. */
export const CATEGORY_STYLE: Record<
  BlogCategory,
  { badge: string; accent: string }
> = {
  tips: {
    badge: "bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    accent: "from-violet-500/80 via-violet-700/40 to-transparent",
  },
  product: {
    badge: "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
    accent: "from-cyan-500/80 via-cyan-700/40 to-transparent",
  },
  business: {
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    accent: "from-amber-500/80 via-orange-700/40 to-transparent",
  },
  trends: {
    badge: "bg-pink-50 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
    accent: "from-pink-500/80 via-rose-700/40 to-transparent",
  },
};

function formatDate(iso: string, lang: Lang) {
  const d = new Date(iso);
  const locales: Record<Lang, string> = { ru: "ru-RU", ua: "uk-UA", en: "en-GB", pl: "pl-PL" };
  return d.toLocaleDateString(locales[lang], { day: "numeric", month: "long", year: "numeric" });
}

function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function BlogClient() {
  const { lang } = useLang();
  const copy = UI[lang] ?? UI.en;
  const [filter, setFilter] = useState<BlogCategory | null>(null);

  const articles = useMemo(() => {
    const sorted = [...BLOG_ARTICLES].sort((a, b) => b.date.localeCompare(a.date));
    if (!filter) return sorted;
    return sorted.filter((a) => a.categoryKey === filter);
  }, [filter]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 pb-20 animate-fade-in">
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

      {/* Articles grid */}
      {articles.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
          {copy.noResults}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map((article) => {
            const style = CATEGORY_STYLE[article.categoryKey];
            const mins = readingMinutes(article.bodies[lang] ?? article.bodies.ru);
            return (
              <Link
                key={article.slug}
                href={`/blog/${article.slug}`}
                className="group rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 dark:border-white/[0.08] dark:bg-slate-900/50 overflow-hidden flex flex-col"
              >
                {/* Cover image */}
                <div className="relative aspect-[16/9] overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <Image
                    src={article.coverImage.url}
                    alt={article.coverImage.alt[lang] ?? article.coverImage.alt.en}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    unoptimized
                  />
                  <div
                    className={`pointer-events-none absolute inset-0 bg-gradient-to-t ${style.accent} opacity-70`}
                  />
                </div>

                {/* Content */}
                <div className="flex flex-col flex-1 p-5">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
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
                    <span className="inline-flex items-center text-[11px] text-slate-400 dark:text-white/30">
                      · {mins} min
                    </span>
                  </div>

                  <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug line-clamp-2 mb-1.5">
                    {article.titles[lang]}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-3 flex-1">
                    {article.excerpts[lang]}
                  </p>

                  <div className="mt-4 text-sm font-medium text-violet-600 dark:text-violet-400 group-hover:text-violet-500 transition-colors">
                    {copy.readMore}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
