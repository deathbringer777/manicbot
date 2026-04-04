import { useState, useEffect, useRef } from "react";
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

interface CityResult {
  cities: string[];
}

type SearchItem =
  | { type: "salon"; data: Salon }
  | { type: "article"; data: Article }
  | { type: "city"; data: string }
  | { type: "all"; data: null };

export function SearchAutocomplete({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { t } = useLanguage();
  const [value, setValue] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [data, setData] = useState<AutocompleteResult | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingCities, setIsFetchingCities] = useState(false);
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  const [geoFailed, setGeoFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(value.trim()), 260);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    setIsFetchingCities(true);
    fetch(`${API_BASE}/api/search/cities`)
      .then((res) => res.json())
      .then((json: CityResult) => {
        if (!cancelled) setCities(Array.isArray(json.cities) ? json.cities : []);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      })
      .finally(() => {
        if (!cancelled) setIsFetchingCities(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (debouncedQ.length < 2) {
      setData(null);
      setIsFetching(false);
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

    return () => {
      cancelled = true;
    };
  }, [debouncedQ]);

  const salons = data?.salons ?? [];
  const articles = data?.articles ?? [];
  const trimmedValue = value.trim();
  const isSearchMode = debouncedQ.length >= 2;

  const items: SearchItem[] = isSearchMode
    ? [
        ...salons.map((salon) => ({ type: "salon" as const, data: salon })),
        ...articles.map((article) => ({ type: "article" as const, data: article })),
        { type: "all" as const, data: null },
      ]
    : [
        ...cities.map((city) => ({ type: "city" as const, data: city })),
        { type: "all" as const, data: null },
      ];

  useEffect(() => {
    setActiveIdx(-1);
  }, [debouncedQ, open]);

  const navigate = (url: string) => {
    window.location.href = url;
  };

  const handleGeo = () => {
    if (!navigator.geolocation) {
      setGeoFailed(true);
      setTimeout(() => setGeoFailed(false), 3000);
      return;
    }
    setIsGeoLoading(true);
    setGeoFailed(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsGeoLoading(false);
        navigate(`${API_BASE}/search?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      },
      () => {
        setIsGeoLoading(false);
        setGeoFailed(true);
        setTimeout(() => setGeoFailed(false), 3000);
      },
      { timeout: 10000 }
    );
  };

  const handleSelect = (idx: number) => {
    const item = items[idx];
    if (!item) return;

    if (item.type === "salon" && item.data.slug) {
      navigate(`${API_BASE}/salon/${item.data.slug}`);
    } else if (item.type === "article") {
      navigate(`${API_BASE}/blog/${item.data.slug}`);
    } else if (item.type === "city") {
      navigate(`${API_BASE}/search?q=${encodeURIComponent(item.data)}`);
    } else {
      navigate(
        trimmedValue
          ? `${API_BASE}/search?q=${encodeURIComponent(trimmedValue)}`
          : `${API_BASE}/search`
      );
    }

    setOpen(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(
      trimmedValue
        ? `${API_BASE}/search?q=${encodeURIComponent(trimmedValue)}`
        : `${API_BASE}/search`
    );
    setOpen(false);
  };

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
    if (!open || items.length === 0) return;

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

  if (compact) {
    return (
      <div ref={containerRef} className={`relative ${className}`}>
        <form onSubmit={handleSubmit} className="relative w-full">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-white/30 sm:left-3 sm:h-4 sm:w-4"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => { setValue(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={t.hero.searchPlaceholder}
            className="h-8 w-full rounded-full border border-slate-200/80 bg-slate-50/80 pl-7 pr-7 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400/60 focus:bg-white focus:ring-2 focus:ring-violet-400/15 dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-white/30 dark:focus:border-violet-500/40 dark:focus:bg-white/[0.08] sm:h-9 sm:pl-9 sm:text-sm"
          />
          {isGeoLoading ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-500" />
          ) : value ? (
            <button
              type="button"
              onClick={() => { setValue(""); setDebouncedQ(""); setData(null); setOpen(true); inputRef.current?.focus(); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 transition hover:text-slate-600 dark:text-white/30 dark:hover:text-white/70"
              aria-label="Clear"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleGeo}
              title={t.search.geoButton}
              className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 transition ${geoFailed ? "text-red-400" : "text-slate-400 hover:text-violet-500 dark:text-white/30 dark:hover:text-violet-400"}`}
              aria-label={t.search.geoButton}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6z" />
                <circle cx="12" cy="8" r="2.5" />
              </svg>
            </button>
          )}
        </form>
        {open && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_28px_80px_-28px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 dark:shadow-[0_32px_90px_-30px_rgba(2,6,23,0.82)]"
            style={{ animation: "searchDropdownIn 0.16s ease-out", minWidth: "320px" }}
          >
            <style>{`@keyframes searchDropdownIn { from { opacity:0; transform:translateY(-6px) scale(0.985); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
            {isSearchMode ? (
              <>
                {isFetching && salons.length === 0 && articles.length === 0 && (
                  <div className="space-y-1.5 p-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="flex animate-pulse items-center gap-2.5 rounded-xl p-1.5">
                        <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                          <div className="h-2.5 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!isFetching && salons.length === 0 && articles.length === 0 && (
                  <div className="px-4 py-4">
                    <p className="text-sm text-slate-600 dark:text-slate-400">{t.search.noResults} "{debouncedQ}"</p>
                    <a href={`${API_BASE}/search?q=${encodeURIComponent(debouncedQ)}`} className="mt-3 inline-flex rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
                      {t.search.showAll}
                    </a>
                  </div>
                )}
                {(salons.length > 0 || articles.length > 0) && (
                  <div className="py-1.5">
                    {salons.length > 0 && (
                      <>
                        <p className="px-4 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-600">{t.search.salonsLabel}</p>
                        {salons.map((salon, i) => (
                          <a key={salon.slug ?? `${salon.name}-${i}`} href={salon.slug ? `${API_BASE}/salon/${salon.slug}` : "#"} onClick={() => setOpen(false)}
                            className={`flex items-center gap-2.5 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${activeIdx === i ? "bg-slate-50 dark:bg-white/[0.06]" : ""}`}>
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                              {salon.coverPhoto ? <img src={salon.coverPhoto} alt={salon.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-base">💅</div>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{salon.name}</p>
                              {salon.city && <p className="mt-0.5 text-xs text-slate-500">{salon.city}</p>}
                            </div>
                          </a>
                        ))}
                      </>
                    )}
                    {articles.length > 0 && (
                      <>
                        <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-white/10" />
                        {articles.map((article, i) => {
                          const idx = salons.length + i;
                          return (
                            <a key={article.slug} href={`${API_BASE}/blog/${article.slug}`} onClick={() => setOpen(false)}
                              className={`flex items-center gap-2.5 px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${activeIdx === idx ? "bg-slate-50 dark:bg-white/[0.06]" : ""}`}>
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/10">
                                <svg className="h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              </div>
                              <p className="truncate text-sm text-slate-700 dark:text-slate-300">{article.title}</p>
                            </a>
                          );
                        })}
                      </>
                    )}
                    <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-white/10" />
                    <button type="button" onClick={() => handleSelect(items.length - 1)}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-white/[0.06]">
                      <span className="font-medium text-violet-700 dark:text-violet-300">{t.search.showAllFor} "{debouncedQ}"</span>
                      <span className="text-slate-400">↗</span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-600">{t.search.popularCities}</p>
                {isFetchingCities ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">{[1,2,3,4].map(i => <div key={i} className="h-7 w-20 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />)}</div>
                ) : (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {cities.map((city, i) => (
                      <button key={city} type="button" onClick={() => handleSelect(i)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${activeIdx === i ? "border-cyan-300/50 bg-cyan-50 text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-400/12 dark:text-cyan-200" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/75 dark:hover:bg-white/[0.08]"}`}>
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        {city}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 border-t border-slate-100 pt-2.5 dark:border-white/10">
                  <button type="button" onClick={() => handleSelect(items.length - 1)}
                    className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:text-white/75 dark:hover:bg-white/[0.06]">
                    <span>{t.search.openCatalog}</span>
                    <span className="text-slate-400">↗</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 lg:flex-row lg:items-center"
      >
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="search"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={t.hero.searchPlaceholder}
            className="h-14 w-full rounded-[1.75rem] border border-slate-200 bg-white px-5 pr-11 text-base text-slate-900 placeholder:text-slate-400 shadow-[0_16px_50px_-28px_rgba(15,23,42,0.28)] outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/12 dark:border-white/10 dark:bg-slate-950/90 dark:text-white dark:placeholder:text-white/35 dark:shadow-[0_20px_60px_-28px_rgba(8,145,178,0.3)]"
          />

          {value && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                setDebouncedQ("");
                setData(null);
                setOpen(true);
                inputRef.current?.focus();
              }}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Clear search"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleGeo}
          disabled={isGeoLoading}
          title={t.search.geoButton}
          className={`h-14 shrink-0 rounded-[1.75rem] border px-5 text-sm font-semibold transition hover:scale-[1.01] ${
            geoFailed
              ? "border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-400"
              : "border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:text-violet-700 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/75 dark:hover:border-violet-400/40 dark:hover:text-violet-300"
          }`}
        >
          {isGeoLoading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
              <span className="hidden sm:inline">{t.search.geoButton}</span>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 12 6 12s6-6.75 6-12c0-3.314-2.686-6-6-6z" />
                <circle cx="12" cy="8" r="2.5" />
              </svg>
              <span className="hidden sm:inline">{geoFailed ? t.search.geoError : t.search.geoButton}</span>
            </span>
          )}
        </button>
        <button
          type="submit"
          className="h-14 shrink-0 rounded-[1.75rem] px-7 text-sm font-semibold text-white shadow-[0_18px_50px_-20px_rgba(34,211,238,0.5)] transition hover:scale-[1.01] hover:opacity-95"
          style={{ background: "linear-gradient(135deg,#6d28d9,#0891b2)" }}
        >
          {t.nav.findSalon}
        </button>
      </form>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-3 overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white/95 shadow-[0_28px_80px_-28px_rgba(15,23,42,0.22)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/95 dark:shadow-[0_32px_90px_-30px_rgba(2,6,23,0.82)]"
          style={{ animation: "searchDropdownIn 0.16s ease-out" }}
        >
          <style>{`
            @keyframes searchDropdownIn {
              from { opacity: 0; transform: translateY(-8px) scale(0.985); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          `}</style>

          {isSearchMode ? (
            <>
              {isFetching && salons.length === 0 && articles.length === 0 && (
                <div className="space-y-2 p-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex animate-pulse items-center gap-3 rounded-2xl p-2">
                      <div className="h-11 w-11 rounded-xl bg-slate-100 dark:bg-slate-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                        <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!isFetching && salons.length === 0 && articles.length === 0 && (
                <div className="px-5 py-6">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {t.search.noResults} “{debouncedQ}”
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                    {t.search.quickHint}
                  </p>
                  <a
                    href={`${API_BASE}/search?q=${encodeURIComponent(debouncedQ)}`}
                    className="mt-4 inline-flex rounded-full border border-violet-200 bg-violet-50 px-3.5 py-2 text-xs font-semibold text-violet-700 transition hover:border-violet-300 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15"
                  >
                    {t.search.showAll}
                  </a>
                </div>
              )}

              {(salons.length > 0 || articles.length > 0) && (
                <div className="py-2">
                  {salons.length > 0 && (
                    <>
                      <p className="px-5 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-600">
                        {t.search.salonsLabel}
                      </p>
                      {salons.map((salon, i) => (
                        <a
                          key={salon.slug ?? `${salon.name}-${i}`}
                          href={salon.slug ? `${API_BASE}/salon/${salon.slug}` : "#"}
                          onClick={() => setOpen(false)}
                          className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${
                            activeIdx === i ? "bg-slate-50 dark:bg-white/[0.06]" : ""
                          }`}
                        >
                          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800">
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
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-500">
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                {salon.city}
                              </p>
                            )}
                          </div>
                        </a>
                      ))}
                    </>
                  )}

                  {articles.length > 0 && (
                    <>
                      <div className="mx-4 my-2 border-t border-slate-100 dark:border-white/10" />
                      <p className="px-5 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-600">
                        {t.search.articlesLabel}
                      </p>
                      {articles.map((article, i) => {
                        const idx = salons.length + i;
                        return (
                          <a
                            key={article.slug}
                            href={`${API_BASE}/blog/${article.slug}`}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${
                              activeIdx === idx ? "bg-slate-50 dark:bg-white/[0.06]" : ""
                            }`}
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-500/10">
                              <svg className="h-5 w-5 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <p className="truncate text-sm text-slate-700 dark:text-slate-300">{article.title}</p>
                          </a>
                        );
                      })}
                    </>
                  )}

                  <div className="mx-4 my-2 border-t border-slate-100 dark:border-white/10" />
                  <button
                    type="button"
                    onClick={() => handleSelect(items.length - 1)}
                    className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${
                      activeIdx === items.length - 1 ? "bg-slate-50 dark:bg-white/[0.06]" : ""
                    }`}
                  >
                    <span className="font-medium text-violet-700 dark:text-violet-300">
                      {t.search.showAllFor} “{debouncedQ}”
                    </span>
                    <span className="text-slate-400 dark:text-slate-500">↗</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="p-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-600">
                  {t.search.popularCities}
                </p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {trimmedValue ? t.search.keepTyping : t.search.quickHint}
                </p>
              </div>

              {isFetchingCities ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-9 w-28 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {cities.map((city, i) => (
                    <button
                      key={city}
                      type="button"
                      onClick={() => handleSelect(i)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition ${
                        activeIdx === i
                          ? "border-cyan-300/50 bg-cyan-50 text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-400/12 dark:text-cyan-200"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/75 dark:hover:bg-white/[0.08]"
                      }`}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      {city}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => handleSelect(items.length - 1)}
                  className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-sm font-medium transition ${
                    activeIdx === items.length - 1
                      ? "bg-slate-50 text-slate-900 dark:bg-white/[0.06] dark:text-white"
                      : "text-slate-700 hover:bg-slate-50 dark:text-white/75 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  <span>{t.search.openCatalog}</span>
                  <span className="text-slate-400 dark:text-slate-500">↗</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
