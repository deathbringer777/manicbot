"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { MapPin, Locate, X, ChevronRight, SlidersHorizontal, ChevronDown } from "lucide-react";
import { api } from "~/trpc/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SearchAutocomplete } from "~/components/public/SearchAutocomplete";
import { t } from "~/lib/i18n";
import { useLang } from "~/components/LangContext";

const SERVICE_CHIPS = [
  { label: "Маникюр", value: "маникюр" },
  { label: "Педикюр", value: "педикюр" },
  { label: "Nail-арт", value: "nail art" },
  { label: "Гель", value: "гель" },
  { label: "Акрил", value: "акрил" },
  { label: "Наращивание", value: "наращивание" },
  { label: "Покрытие", value: "покрытие" },
  { label: "Снятие", value: "снятие" },
];

function SalonCard({ item }: { item: {
  id: string; slug: string | null; name: string; city: string | null;
  address: string | null; description: string | null; coverPhoto: string | null;
  distanceKm: number | null; mapsUrl: string | null;
} }) {
  return (
    <Link
      href={item.slug ? `/salon/${item.slug}` : "#"}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white transition hover:border-violet-300 hover:shadow-lg hover:shadow-violet-500/10 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40 dark:hover:shadow-brand-500/10"
    >
      <div className="relative h-44 bg-slate-100 dark:bg-slate-800">
        {item.coverPhoto ? (
          <img src={item.coverPhoto} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl">💅</div>
        )}
        {item.distanceKm != null && (
          <span className="absolute right-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium text-slate-700 backdrop-blur dark:bg-slate-950/80 dark:text-slate-300">
            {item.distanceKm < 1
              ? `${Math.round(item.distanceKm * 1000)} м`
              : `${item.distanceKm} км`}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-semibold text-slate-900 group-hover:text-violet-600 dark:text-white dark:group-hover:text-brand-400">{item.name}</h3>
        {(item.city ?? item.address) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3 w-3" />
            {item.city}{item.address ? `, ${item.address}` : ""}
          </p>
        )}
        {item.description && (
          <p className="mt-2 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{item.description}</p>
        )}
        <div className="mt-auto pt-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-600 dark:bg-brand-500/10 dark:text-brand-400">
            Онлайн-запись
          </span>
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-violet-500 dark:text-slate-600 dark:group-hover:text-brand-400" />
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white animate-pulse dark:border-slate-800 dark:bg-slate-900">
      <div className="h-44 bg-slate-100 dark:bg-slate-800" />
      <div className="p-4 space-y-2">
        <div className="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
        <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800" />
      </div>
    </div>
  );
}

function CityDropdown({
  value,
  cities,
  placeholder,
  onChange,
}: {
  value: string;
  cities: string[];
  placeholder: string;
  onChange: (city: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={ref} className="relative sm:w-48">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-xl border py-3 pl-3 pr-3 text-sm transition outline-none ${
          value
            ? "border-violet-400 bg-white text-slate-800 ring-2 ring-violet-500/20 dark:border-violet-500/60 dark:bg-slate-900 dark:text-white dark:ring-violet-500/20"
            : "border-slate-200/80 bg-white text-slate-400 hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-500 dark:hover:border-slate-600"
        }`}
      >
        <MapPin className={`h-4 w-4 shrink-0 ${value ? "text-violet-500 dark:text-violet-400" : "text-slate-400 dark:text-slate-500"}`} />
        <span className={`flex-1 truncate text-left ${value ? "text-slate-800 dark:text-white" : ""}`}>
          {value || placeholder}
        </span>
        {value ? (
          <X
            className="h-3.5 w-3.5 shrink-0 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-white"
            onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}
          />
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${open ? "rotate-180" : ""}`} />
        )}
      </button>

      {open && cities.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[10rem] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-900 dark:shadow-black/40">
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm transition hover:bg-slate-50 dark:hover:bg-white/[0.06] ${
                c === value
                  ? "bg-violet-50 font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                  : "text-slate-700 dark:text-slate-300"
              }`}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchPageContent() {
  const { lang } = useLang();
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const urlCity = searchParams.get("city") ?? "";

  const [query, setQuery] = useState(urlQ);
  const [city, setCity] = useState(urlCity);
  const [activeChips, setActiveChips] = useState<string[]>([]);
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [locating, setLocating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  // Sync URL params on mount / change so popular-city links pre-fill the
  // city filter and so deep-links from outside remain bookmarkable.
  useEffect(() => {
    if (urlQ) setQuery(urlQ);
  }, [urlQ]);
  useEffect(() => {
    if (urlCity) setCity(urlCity);
  }, [urlCity]);

  const fullQuery = [query, ...activeChips].filter(Boolean).join(" ");

  const citiesQuery = api.publicSalon.getCities.useQuery();

  const searchQuery = api.publicSalon.search.useQuery(
    {
      query: fullQuery || undefined,
      city: city || undefined,
      lat,
      lng,
      radiusKm: lat != null ? 20 : 50,
      page,
      limit: 20,
    },
    { enabled: true }
  );

  const locate = useCallback(() => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
    );
  }, []);

  function toggleChip(v: string) {
    setActiveChips((prev) =>
      prev.includes(v) ? prev.filter((c) => c !== v) : [...prev, v],
    );
    setPage(1);
  }

  const items = searchQuery.data?.items ?? [];
  const hasMore = searchQuery.data?.hasMore ?? false;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t("search.title", lang)}</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400">{t("search.subtitle", lang)}</p>
      </div>

      {/* Search bar with autocomplete */}
      <div className="mb-4">
        <SearchAutocomplete
          initialValue={query}
          onSearch={(q) => {
            if (!q.trim()) {
              setQuery("");
              setCity("");
              setActiveChips([]);
              setLat(undefined);
              setLng(undefined);
              setPage(1);
            } else {
              setQuery(q);
              setPage(1);
            }
          }}
          placeholder={t("search.placeholder", lang)}
          autoFocus={false}
        />
      </div>

      {/* City + geo + filters row */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <CityDropdown
          value={city}
          cities={citiesQuery.data ?? []}
          placeholder={t("search.city", lang)}
          onChange={(c) => { setCity(c); setPage(1); }}
        />

        <button
          onClick={locate}
          disabled={locating}
          title={t("search.nearby", lang)}
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition ring-1 ${lat != null
            ? "bg-violet-600 text-white ring-violet-600 hover:bg-violet-700 dark:bg-brand-500 dark:ring-brand-500 dark:hover:bg-brand-600"
            : "bg-white text-slate-600 ring-slate-200/80 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800"}`}
        >
          <Locate className={`h-4 w-4 ${locating ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{t("search.nearbyShort", lang)}</span>
        </button>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ring-1 transition ${showFilters
            ? "bg-slate-200 text-slate-900 ring-slate-300 dark:bg-slate-700 dark:text-white dark:ring-slate-600"
            : "bg-white text-slate-600 ring-slate-200/80 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800"}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">{t("search.filters", lang)}</span>
          {activeChips.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white dark:bg-brand-500">
              {activeChips.length}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SERVICE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              onClick={() => toggleChip(chip.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${activeChips.includes(chip.value)
                ? "bg-violet-600 text-white dark:bg-brand-500"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"}`}
            >
              {chip.label}
            </button>
          ))}
          {activeChips.length > 0 && (
            <button
              onClick={() => setActiveChips([])}
              className="flex items-center gap-1 rounded-full bg-slate-100 px-3.5 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              {t("search.clear", lang)}
            </button>
          )}
        </div>
      )}

      {lat != null && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-sm text-violet-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Locate className="h-3.5 w-3.5" />
          {t("search.nearYou", lang)}
          <button onClick={() => { setLat(undefined); setLng(undefined); }} className="ml-1 text-violet-500 hover:text-violet-800 dark:text-brand-400 dark:hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="mt-8">
        {searchQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-20 flex flex-col items-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-100 text-4xl dark:bg-slate-900">🔍</div>
            <div>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">{t("search.notFound", lang)}</p>
              <p className="mt-1 text-sm text-slate-500">
                {query || city || activeChips.length > 0
                  ? t("search.tryOther", lang)
                  : t("search.noSalons", lang)}
              </p>
            </div>
            {(query || city || activeChips.length > 0) && (
              <button
                onClick={() => { setQuery(""); setCity(""); setActiveChips([]); setLat(undefined); setLng(undefined); }}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                {t("search.clearAll", lang)}
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              {t("search.found", lang)}: {items.length}
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <SalonCard key={item.id} item={item} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-xl bg-slate-100 px-6 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  Показать ещё
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="h-10 w-48 rounded bg-slate-100 animate-pulse mb-8 dark:bg-slate-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white animate-pulse dark:border-slate-800 dark:bg-slate-900">
              <div className="h-44 bg-slate-100 dark:bg-slate-800" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}
