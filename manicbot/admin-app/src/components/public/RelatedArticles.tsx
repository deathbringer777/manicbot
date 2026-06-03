"use client";

import Image from "next/image";
import Link from "next/link";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import type { BlogArticle } from "~/content/blog/articles";
import { BLOG_CATEGORY_LABELS } from "~/content/blog/articles";
import { CATEGORY_STYLE } from "~/app/(public)/blog/BlogClient";

const HEADING: Record<Lang, string> = {
  ru: "Похожие статьи",
  ua: "Схожі статті",
  en: "Related articles",
  pl: "Powiązane artykuły",
};

const READ_MORE: Record<Lang, string> = {
  ru: "Читать →",
  ua: "Читати →",
  en: "Read →",
  pl: "Czytaj →",
};

export function RelatedArticles({ articles }: { articles: BlogArticle[] }) {
  const { lang } = useLang();
  if (articles.length === 0) return null;

  return (
    <section className="mt-16 pt-10 border-t border-slate-200 dark:border-white/10">
      <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white mb-6">
        {HEADING[lang]}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {articles.map((article) => {
          const style = CATEGORY_STYLE[article.categoryKey];
          return (
            <Link
              key={article.slug}
              href={`/blog/${article.slug}`}
              className="group rounded-xl border border-slate-200/90 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 dark:border-white/[0.08] dark:bg-slate-900/50 overflow-hidden flex flex-col"
            >
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
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-t ${style.accent} opacity-60`}
                />
              </div>
              <div className="p-4 flex flex-col flex-1">
                <span
                  className={`inline-flex items-center self-start gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge} mb-2`}
                >
                  {BLOG_CATEGORY_LABELS[article.categoryKey][lang]}
                </span>
                <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-white line-clamp-2 mb-1.5">
                  {article.titles[lang]}
                </h3>
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2 flex-1">
                  {article.excerpts[lang]}
                </p>
                <div className="mt-3 text-xs font-medium text-violet-600 dark:text-violet-400 group-hover:text-brand-500">
                  {READ_MORE[lang]}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
