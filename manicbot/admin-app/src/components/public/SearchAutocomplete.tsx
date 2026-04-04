"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, MapPin, ChevronRight, FileText } from "lucide-react";
import { api } from "~/trpc/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Lang } from "~/lib/i18n";

function useLang(): Lang {
  if (typeof navigator !== "undefined") {
    const lc = navigator.language?.slice(0, 2);
    if (lc === "uk") return "ua";
    if (lc === "en" || lc === "pl") return lc;
  }
  return "ru";
}

interface Props {
  initialValue?: string;
  onSearch?: (q: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchAutocomplete({ initialValue = "", onSearch, placeholder, autoFocus }: Props) {
  const lang = useLang();
  const [value, setValue] = useState(initialValue);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const resolvedPlaceholder = placeholder ?? t("search.placeholder", lang);

  // Debounce input -> query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(value.trim()), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const { data, isFetching } = api.publicSalon.autocomplete.useQuery(
    { q: debouncedQ },
    { enabled: debouncedQ.length >= 2, staleTime: 30_000 },
  );

  const { data: citiesData } = api.publicSalon.getCities.useQuery(undefined, {
    staleTime: 60_000,
  });
  const popularCities = citiesData ?? [];

  const salons = data?.salons ?? [];
  const articles = data?.articles ?? [];
  const hasResults = salons.length > 0 || articles.length > 0;
  const isShortQuery = debouncedQ.length < 2;
  const showDropdown = open && (isShortQuery ? popularCities.length > 0 : true);

  // All navigable items (salons first, then articles, then "show all")
  const items = [
    ...salons.map((s) => ({ type: "salon" as const, data: s })),
    ...articles.map((a) => ({ type: "article" as const, data: a })),
    { type: "all" as const, data: null },
  ];

  const handleSelect = useCallback((idx: number) => {
    const item = items[idx];
    if (!item) return;
    if (item.type === "salon" && item.data?.slug) {
      router.push(`/salon/${item.data.slug}`);
    } else if (item.type === "article") {
      router.push(`/blog/${item.data?.slug}`);
    } else {
      router.push(`/search?q=${encodeURIComponent(value)}`);
    }
    setOpen(false);
  }, [items, value, router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      if (onSearch) {
        onSearch(value.trim());
      } else {
        router.push(`/search?q=${encodeURIComponent(value.trim())}`);
      }
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
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setOpen(true); setActiveIdx(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={resolvedPlaceholder}
            className="w-full rounded-2xl border border-slate-200/80 bg-white py-3.5 pl-10 pr-10 text-sm text-slate-800 placeholder-slate-400 shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-slate-700/60 dark:bg-slate-900 dark:text-white dark:placeholder-slate-500 dark:shadow-lg dark:shadow-black/20 dark:focus:border-violet-500/60 dark:focus:ring-violet-500/20"
          />
          {value && (
            <button
              type="button"
              onClick={() => { setValue(""); setDebouncedQ(""); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-white transition"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="shrink-0 rounded-2xl px-5 py-3 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:scale-[1.02] hover:opacity-95 dark:shadow-violet-900/30"
          style={{ background: "linear-gradient(135deg,#6d28d9,#0891b2)" }}
        >
          {t("search.findBtn", lang)}
        </button>
      </form>

      {/* Dropdown */}
      {showDropdown && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-xl dark:border-slate-700/60 dark:bg-slate-900/95 dark:shadow-black/40"
          style={{
            animation: "dropdownIn 0.15s ease-out",
          }}
        >
          <style>{`
            @keyframes dropdownIn {
              from { opacity: 0; transform: translateY(-6px) scale(0.98); }
              to   { opacity: 1; transform: translateY(0)   scale(1); }
            }
          `}</style>

          {/* Popular cities — shown when query is empty/short */}
          {isShortQuery && popularCities.length > 0 && (
            <div className="py-2">
              <p className="px-4 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                {t("search.popularCities", lang)}
              </p>
              {popularCities.slice(0, 8).map((city) => (
                <button
                  key={city}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setValue(city);
                    setOpen(false);
                    if (onSearch) onSearch(city);
                    else router.push(`/search?q=${encodeURIComponent(city)}`);
                  }}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/70"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                    <MapPin className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                  </div>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{city}</span>
                </button>
              ))}
            </div>
          )}

          {!isShortQuery && isFetching && !hasResults && (
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

          {!isShortQuery && !isFetching && !hasResults && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-500">{t("search.nothingFound", lang)} «{debouncedQ}»</p>
              <Link
                href={`/search?q=${encodeURIComponent(debouncedQ)}`}
                className="mt-2 inline-block text-xs text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300"
                onClick={() => setOpen(false)}
              >
                {t("search.showAll", lang)} &rarr;
              </Link>
            </div>
          )}

          {hasResults && (
            <div className="py-2">
              {/* Salons section */}
              {salons.length > 0 && (
                <>
                  <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                    {t("search.salons", lang)}
                  </p>
                  {salons.map((salon, i) => (
                    <Link
                      key={salon.slug ?? i}
                      href={salon.slug ? `/salon/${salon.slug}` : "#"}
                      onClick={() => setOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${activeIdx === i ? "bg-slate-50 dark:bg-slate-800/70" : ""}`}
                    >
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                        {salon.coverPhoto ? (
                          <img src={salon.coverPhoto} alt={salon.name} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-lg">💅</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{salon.name}</p>
                        {salon.city && (
                          <p className="flex items-center gap-1 text-xs text-slate-500">
                            <MapPin className="h-3 w-3" />
                            {salon.city}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
                    </Link>
                  ))}
                </>
              )}

              {/* Articles section */}
              {articles.length > 0 && (
                <>
                  <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-slate-800" />
                  <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-600">
                    {t("search.articles", lang)}
                  </p>
                  {articles.map((art, i) => {
                    const idx = salons.length + i;
                    return (
                      <Link
                        key={art.slug}
                        href={`/blog/${art.slug}`}
                        onClick={() => setOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${activeIdx === idx ? "bg-slate-50 dark:bg-slate-800/70" : ""}`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/10 text-lg">
                          <FileText className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                        </div>
                        <p className="truncate text-sm text-slate-700 dark:text-slate-300">{art.title}</p>
                      </Link>
                    );
                  })}
                </>
              )}

              {/* Show all results */}
              <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-slate-800" />
              <Link
                href={`/search?q=${encodeURIComponent(debouncedQ)}`}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between px-4 py-2.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/70 ${activeIdx === items.length - 1 ? "bg-slate-50 dark:bg-slate-800/70" : ""}`}
              >
                <span className="text-violet-600 font-medium dark:text-violet-400">{t("search.showAllFor", lang)} «{debouncedQ}»</span>
                <ChevronRight className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
