"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { Lang } from "~/lib/i18n";
import {
  HELP_ARTICLES,
  HELP_CATEGORY_LABELS,
  HELP_CATEGORY_ORDER,
  HELP_FAQS,
  filterScoreArticle,
  filterScoreFaq,
  getHelpSuggestions,
  helpHasActiveSearch,
  type HelpSuggestion,
} from "~/content/help/articles";
import { getHelpFiguresForSlug } from "~/content/help/helpArticleFigures";
import { HelpArticleFigures } from "./HelpUiMock";

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
    collapse: string;
    allCollections: string;
    articlesCount: (n: number) => string;
    suggestionsEmpty: string;
    faqMark: string;
    figureExample: string;
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
    collapse: "Свернуть",
    allCollections: "Все разделы",
    articlesCount: (n) => `Статей: ${n}`,
    suggestionsEmpty: "Нет совпадений — продолжайте ввод",
    faqMark: "FAQ",
    figureExample: "Пример",
  },
  ua: {
    kicker: "Довідковий центр",
    title: "Відповіді та інструкції",
    subtitle: "Пошук за ключовими словами: скасування, запис, тикет, послуги…",
    searchPlaceholder: "Пошук по статтях та FAQ…",
    articles: "Статті",
    faq: "Часті питання",
    noResults: "Нічого не знайдено — спробуйте інші слова.",
    collapse: "Згорнути",
    allCollections: "Усі розділи",
    articlesCount: (n) => `Статей: ${n}`,
    suggestionsEmpty: "Немає збігів — продовжуйте вводити",
    faqMark: "FAQ",
    figureExample: "Example",
  },
  en: {
    kicker: "Help center",
    title: "Guides & answers",
    subtitle: "Search by keywords: cancel, booking, ticket, services, support…",
    searchPlaceholder: "Search articles and FAQ…",
    articles: "Articles",
    faq: "Common questions",
    noResults: "No matches — try different words.",
    collapse: "Collapse",
    allCollections: "All collections",
    articlesCount: (n) => `${n} articles`,
    suggestionsEmpty: "No matches — keep typing",
    faqMark: "FAQ",
    figureExample: "Example",
  },
  pl: {
    kicker: "Centrum pomocy",
    title: "Poradniki i odpowiedzi",
    subtitle: "Szukaj: anulowanie, rezerwacja, zgłoszenie, usługi, wsparcie…",
    searchPlaceholder: "Szukaj w artykułach i FAQ…",
    articles: "Artykuły",
    faq: "Częste pytania",
    noResults: "Brak wyników — spróbuj innych słów.",
    collapse: "Zwiń",
    allCollections: "Wszystkie sekcje",
    articlesCount: (n) => `Artykułów: ${n}`,
    suggestionsEmpty: "Brak dopasowań — wpisuj dalej",
    faqMark: "FAQ",
    figureExample: "Przykład",
  },
};

export function HelpCenterClient() {
  const { lang } = useLang();
  const copy = UI[lang] ?? UI.en;
  const [q, setQ] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSearch = helpHasActiveSearch(q);

  const suggestions = useMemo(() => getHelpSuggestions(lang, q, 14), [lang, q]);

  const articleItems = useMemo(() => {
    const items = HELP_ARTICLES.map((a) => ({
      a,
      s: filterScoreArticle(a, lang, q),
    }));
    if (!hasSearch) return items;
    return items.filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  }, [lang, q, hasSearch]);

  const byCategory = useMemo(() => {
    const m = new Map<
      (typeof HELP_CATEGORY_ORDER)[number],
      { a: (typeof HELP_ARTICLES)[number]; s: number }[]
    >();
    for (const k of HELP_CATEGORY_ORDER) m.set(k, []);
    for (const it of articleItems) {
      m.get(it.a.categoryKey)?.push(it);
    }
    return m;
  }, [articleItems]);

  const faqItems = useMemo(() => {
    const items = HELP_FAQS.map((f, i) => ({
      f,
      i,
      s: filterScoreFaq(f, lang, q),
    }));
    if (!hasSearch) return items;
    return items.filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  }, [lang, q, hasSearch]);

  const totalArticlesShown = articleItems.length;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const applySuggestion = (s: HelpSuggestion) => {
    setSuggestOpen(false);
    inputRef.current?.blur();
    if (s.kind === "article") {
      setOpenFaqIndex(null);
      setOpenSlug(s.slug);
      requestAnimationFrame(() => {
        document.getElementById(`article-${s.slug}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      setOpenSlug(null);
      setOpenFaqIndex(s.index);
      requestAnimationFrame(() => {
        document.getElementById(`faq-${s.index}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  const showSuggestPanel = suggestOpen && q.trim().length >= 2;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 pb-20">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400 mb-2">
          {copy.kicker}
        </p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {copy.title}
        </h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">{copy.subtitle}</p>

        <div ref={wrapRef} className="mt-8 relative max-w-lg mx-auto z-30">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSuggestOpen(true);
            }}
            onFocus={() => setSuggestOpen(true)}
            placeholder={copy.searchPlaceholder}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={showSuggestPanel}
            className="relative w-full rounded-2xl border border-slate-200 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-slate-900/80 dark:text-white dark:placeholder:text-slate-500"
          />
          {showSuggestPanel ? (
            <div
              className="absolute left-0 right-0 top-full mt-2 rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900 max-h-[min(70vh,420px)] overflow-y-auto text-left"
              role="listbox"
            >
              {suggestions.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{copy.suggestionsEmpty}</p>
              ) : (
                <ul className="py-1">
                  {suggestions.map((s, idx) => (
                    <li key={`${s.kind}-${s.kind === "article" ? s.slug : s.index}-${idx}`}>
                      <button
                        type="button"
                        role="option"
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/5 flex gap-3 items-start"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applySuggestion(s)}
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            s.kind === "faq"
                              ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                              : "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200"
                          }`}
                        >
                          {s.kind === "faq" ? copy.faqMark : HELP_CATEGORY_LABELS[s.categoryKey][lang]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-slate-900 dark:text-white leading-snug">{s.title}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                            {s.subtitle}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <nav className="text-center text-xs text-slate-500 dark:text-slate-400 mb-8">
        <span className="font-medium text-slate-700 dark:text-slate-300">{copy.allCollections}</span>
        {hasSearch ? (
          <span>
            {" "}
            · <span className="text-violet-600 dark:text-violet-400">{q.trim()}</span>
          </span>
        ) : null}
      </nav>

      <section className="mb-14">
        <div className="flex items-center gap-2 mb-5">
          <BookOpen className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{copy.articles}</h2>
          {!hasSearch ? (
            <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
              · {copy.articlesCount(totalArticlesShown)}
            </span>
          ) : null}
        </div>

        {totalArticlesShown === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center rounded-2xl border border-dashed border-slate-200 dark:border-white/10">
            {copy.noResults}
          </p>
        ) : (
          <div className="space-y-8">
            {HELP_CATEGORY_ORDER.map((catKey) => {
              const rows = byCategory.get(catKey) ?? [];
              if (rows.length === 0) return null;
              return (
                <div
                  key={catKey}
                  className="rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/[0.08] dark:bg-slate-900/50 overflow-hidden"
                >
                  <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06] bg-slate-50/80 dark:bg-slate-900/80">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white font-serif tracking-tight">
                      {HELP_CATEGORY_LABELS[catKey][lang]}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{copy.articlesCount(rows.length)}</p>
                  </div>
                  <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
                    {rows.map(({ a }) => {
                      const open = openSlug === a.slug;
                      return (
                        <li key={a.id} id={`article-${a.slug}`}>
                          <button
                            type="button"
                            onClick={() => setOpenSlug(open ? null : a.slug)}
                            className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50/90 dark:hover:bg-white/[0.04] transition-colors"
                          >
                            <span className="flex-1 min-w-0 font-medium text-slate-900 dark:text-white">
                              {a.titles[lang]}
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
                            />
                          </button>
                          {open ? (
                            <div className="px-5 pb-4 pt-0 text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-transparent">
                              <p className="text-xs uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-2">
                                {HELP_CATEGORY_LABELS[a.categoryKey][lang]}
                              </p>
                              <p className="whitespace-pre-line">{a.bodies[lang]}</p>
                              <HelpArticleFigures
                                figures={getHelpFiguresForSlug(a.slug)}
                                lang={lang}
                                exampleLabel={copy.figureExample}
                              />
                              <button
                                type="button"
                                onClick={() => setOpenSlug(null)}
                                className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400"
                              >
                                {copy.collapse}
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">{copy.faq}</h2>
        {faqItems.length === 0 && hasSearch ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{copy.noResults}</p>
        ) : (
          <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-white/[0.08] dark:bg-slate-900/50 overflow-hidden divide-y divide-slate-100 dark:divide-white/[0.06]">
            {faqItems.map(({ f, i }) => {
              const open = openFaqIndex === i;
              return (
                <div key={i} id={`faq-${i}`}>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(open ? null : i)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50/90 dark:hover:bg-white/[0.04]"
                  >
                    <span className="flex-1 min-w-0 font-medium text-slate-900 dark:text-white">{f.questions[lang]}</span>
                    <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>
                  {open ? (
                    <div className="px-5 pb-4 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.answers[lang]}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
