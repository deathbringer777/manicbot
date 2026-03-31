import { useState, useEffect, useRef, useCallback } from "react";
import { useLanguage } from "@/i18n";

const API_BASE = "https://manicbot.com";

interface Salon {
  slug: string | null;
  name: string;
  city: string | null;
  coverPhoto: string | null;
}

interface Article {
  slug: string;
  title: string;
}

interface AutocompleteResult {
  salons: Salon[];
  articles: Article[];
}

export function SearchAutocomplete() {
  const { t } = useLanguage();
  const [value, setValue] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [data, setData] = useState<AutocompleteResult | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce input → query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);

  // Fetch autocomplete from Worker REST API
  useEffect(() => {
    if (debouncedQ.length < 2) {
      setData(null);
      return;
    }
    let cancelled = false;
    setIsFetching(true);
    fetch(`${API_BASE}/api/search/autocomplete?q=${encodeURIComponent(debouncedQ)}`)
      .then((res) => res.json())
      .then((json: AutocompleteResult) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQ]);

  const salons = data?.salons ?? [];
  const articles = data?.articles ?? [];
  const hasResults = salons.length > 0 || articles.length > 0;
  const showDropdown = open && debouncedQ.length >= 2;

  // All navigable items
  const items = [
    ...salons.map((s) => ({ type: "salon" as const, data: s })),
    ...articles.map((a) => ({ type: "article" as const, data: a })),
    { type: "all" as const, data: null },
  ];

  const navigate = useCallback(
    (url: string) => {
      window.location.href = url;
    },
    []
  );

  const handleSelect = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      if (item.type === "salon" && (item.data as Salon)?.slug) {
        navigate(`${API_BASE}/salon/${(item.data as Salon).slug}`);
      } else if (item.type === "article") {
        navigate(`${API_BASE}/blog/${(item.data as Article).slug}`);
      } else {
        navigate(`${API_BASE}/search?q=${encodeURIComponent(value)}`);
      }
      setOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, value, navigate]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q) {
      navigate(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
      setOpen(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(activeIdx);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl mx-auto lg:mx-0">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              setActiveIdx(-1);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={t.hero.searchPlaceholder}
            className="w-full rounded-2xl border border-slate-200/80 bg-white/80 py-3 pl-10 pr-10 text-sm text-slate-800 placeholder-slate-400 shadow-sm backdrop-blur-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:placeholder-white/35 dark:focus:border-violet-500/50"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setDebouncedQ("");
                setData(null);
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-white transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          type="submit"
          className="shrink-0 rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:scale-[1.02] hover:opacity-95 dark:shadow-[0_8px_30px_rgba(109,40,217,0.3)]"
          style={{ background: "linear-gradient(135deg,#6d28d9,#0891b2)" }}
        >
          {t.nav.findSalon}
        </button>
      </form>

      {/* Autocomplete dropdown */}
      {showDropdown && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95 dark:shadow-black/40"
          style={{ animation: "searchDropdownIn 0.15s ease-out" }}
        >
          <style>{`
            @keyframes searchDropdownIn {
              from { opacity: 0; transform: translateY(-6px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0)   scale(1); }
            }
          `}</style>

          {/* Loading skeleton */}
          {isFetching && !hasResults && (
            <div className="space-y-2 p-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex animate-pulse items-center gap-3 rounded-xl p-2">
                  <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                    <div className="h-2.5 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No results */}
          {!isFetching && !hasResults && debouncedQ.length >= 2 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-500">
                {t.search.noResults} «{debouncedQ}»
              </p>
              <a
                href={`${API_BASE}/search?q=${encodeURIComponent(debouncedQ)}`}
                className="mt-2 inline-block text-xs text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300"
              >
                {t.search.showAll} →
              </a>
            </div>
          )}

          {/* Results */}
          {hasResults && (
            <div className="py-2">
              {/* Salons */}
              {salons.length > 0 && (
                <>
                  <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                    {t.search.salonsLabel}
                  </p>
                  {salons.map((salon, i) => (
                    <a
                      key={salon.slug ?? i}
                      href={salon.slug ? `${API_BASE}/salon/${salon.slug}` : "#"}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${activeIdx === i ? "bg-slate-50 dark:bg-slate-800/70" : ""}`}
                    >
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {salon.coverPhoto ? (
                          <img
                            src={salon.coverPhoto}
                            alt={salon.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-lg">💅</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                          {salon.name}
                        </p>
                        {salon.city && (
                          <p className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-500">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {salon.city}
                          </p>
                        )}
                      </div>
                      <svg className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </a>
                  ))}
                </>
              )}

              {/* Articles */}
              {articles.length > 0 && (
                <>
                  <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-slate-800" />
                  <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                    {t.search.articlesLabel}
                  </p>
                  {articles.map((art, i) => {
                    const idx = salons.length + i;
                    return (
                      <a
                        key={art.slug}
                        href={`${API_BASE}/blog/${art.slug}`}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${activeIdx === idx ? "bg-slate-50 dark:bg-slate-800/70" : ""}`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/10">
                          <svg className="h-5 w-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="truncate text-sm text-slate-700 dark:text-slate-300">{art.title}</p>
                      </a>
                    );
                  })}
                </>
              )}

              {/* Show all results */}
              <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-slate-800" />
              <a
                href={`${API_BASE}/search?q=${encodeURIComponent(debouncedQ)}`}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between px-4 py-2.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${activeIdx === items.length - 1 ? "bg-slate-50 dark:bg-slate-800/70" : ""}`}
              >
                <span className="font-medium text-violet-600 dark:text-violet-400">
                  {t.search.showAllFor} «{debouncedQ}»
                </span>
                <svg className="h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
