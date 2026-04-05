"use client";

import { useMemo, useState } from "react";
import { Search, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import {
  HELP_ARTICLES,
  HELP_CATEGORY_LABELS,
  HELP_FAQS,
  normalizeHelpQuery,
  scoreArticle,
  scoreFaq,
} from "~/content/help/articles";

const UI: Record<
  Lang,
  {
    kicker: string;
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    articles: string;
    faq: string;
    noResults: string;
    readMore: string;
    collapse: string;
  }
> = {
  ru: {
    kicker: "Справочный центр",
    title: "Ответы и инструкции",
    subtitle: "Поиск по ключевым словам: отмена, запись, тикет, услуги, поддержка…",
    searchPlaceholder: "Поиск по статьям и FAQ…",
    articles: "Статьи",
    faq: "Частые вопросы",
    noResults: "Ничего не найдено — попробуйте другие слова.",
    readMore: "Подробнее",
    collapse: "Свернуть",
  },
  ua: {
    kicker: "Довідковий центр",
    title: "Відповіді та інструкції",
    subtitle: "Пошук за ключовими словами: скасування, запис, тикет, послуги…",
    searchPlaceholder: "Пошук по статтях та FAQ…",
    articles: "Статті",
    faq: "Часті питання",
    noResults: "Нічого не знайдено — спробуйте інші слова.",
    readMore: "Детальніше",
    collapse: "Згорнути",
  },
  en: {
    kicker: "Help center",
    title: "Guides & answers",
    subtitle: "Search by keywords: cancel, booking, ticket, services, support…",
    searchPlaceholder: "Search articles and FAQ…",
    articles: "Articles",
    faq: "Common questions",
    noResults: "No matches — try different words.",
    readMore: "Read more",
    collapse: "Collapse",
  },
  pl: {
    kicker: "Centrum pomocy",
    title: "Poradniki i odpowiedzi",
    subtitle: "Szukaj: anulowanie, rezerwacja, zgłoszenie, usługi, wsparcie…",
    searchPlaceholder: "Szukaj w artykułach i FAQ…",
    articles: "Artykuły",
    faq: "Częste pytania",
    noResults: "Brak wyników — spróbuj innych słów.",
    readMore: "Więcej",
    collapse: "Zwiń",
  },
};

export function HelpCenterClient() {
  const { lang } = useLang();
  const copy = UI[lang] ?? UI.en;
  const [q, setQ] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const words = useMemo(() => normalizeHelpQuery(q), [q]);

  const articlesRanked = useMemo(() => {
    const scored = HELP_ARTICLES.map((a) => ({
      a,
      s: scoreArticle(a, lang, words),
    }));
    scored.sort((x, y) => y.s - x.s);
    if (words.length === 0) return scored.map((x) => x.a);
    return scored.filter((x) => x.s > 0).map((x) => x.a);
  }, [lang, words]);

  const faqsRanked = useMemo(() => {
    const scored = HELP_FAQS.map((f) => ({ f, s: scoreFaq(f, lang, words) }));
    scored.sort((x, y) => y.s - x.s);
    if (words.length === 0) return scored.map((x) => x.f);
    return scored.filter((x) => x.s > 0).map((x) => x.f);
  }, [lang, words]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 pb-20">
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
        <div className="mt-8 relative max-w-lg mx-auto">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={copy.searchPlaceholder}
            className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-slate-900/80 dark:text-white dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <section className="mb-14">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{copy.articles}</h2>
        </div>
        {articlesRanked.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
            {copy.noResults}
          </p>
        ) : (
          <ul className="space-y-3">
            {articlesRanked.map((a) => {
              const open = openSlug === a.slug;
              return (
                <li
                  key={a.id}
                  id={a.slug}
                  className="rounded-2xl border border-slate-200/90 bg-white/80 backdrop-blur-sm dark:border-white/[0.08] dark:bg-slate-900/40 overflow-hidden"
                >
                  <div className="p-4 sm:p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-1">
                      {HELP_CATEGORY_LABELS[a.categoryKey][lang]}
                    </p>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {a.titles[lang]}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{a.excerpts[lang]}</p>
                    {open && (
                      <p className="text-sm text-slate-700 dark:text-slate-300 mt-3 leading-relaxed whitespace-pre-line">
                        {a.bodies[lang]}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpenSlug(open ? null : a.slug)}
                      className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400"
                    >
                      {open ? copy.collapse : copy.readMore}
                      {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{copy.faq}</h2>
        {faqsRanked.length === 0 && words.length > 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{copy.noResults}</p>
        ) : (
          <div className="space-y-2">
            {(words.length === 0 ? HELP_FAQS : faqsRanked).map((f, i) => (
              <details
                key={i}
                className="group rounded-2xl border border-slate-200/90 bg-white/60 dark:border-white/[0.08] dark:bg-slate-900/30 px-4 py-3"
              >
                <summary className="cursor-pointer list-none font-medium text-slate-900 dark:text-white flex items-center justify-between gap-2">
                  <span>{f.questions[lang]}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 group-open:rotate-180 transition-transform" />
                </summary>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.answers[lang]}</p>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
