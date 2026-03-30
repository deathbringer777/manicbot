"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, MapPin, Locate, X, ChevronRight, SlidersHorizontal } from "lucide-react";
import { api } from "~/trpc/react";
import Link from "next/link";

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
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 transition hover:border-brand-500/40 hover:shadow-lg hover:shadow-brand-500/10"
    >
      {/* Cover */}
      <div className="relative h-44 bg-slate-800">
        {item.coverPhoto ? (
          <img src={item.coverPhoto} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl">💅</div>
        )}
        {item.distanceKm != null && (
          <span className="absolute right-2 top-2 rounded-full bg-slate-950/80 px-2 py-0.5 text-xs font-medium text-slate-300 backdrop-blur">
            {item.distanceKm < 1
              ? `${Math.round(item.distanceKm * 1000)} м`
              : `${item.distanceKm} км`}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-semibold text-white group-hover:text-brand-400">{item.name}</h3>
        {(item.city ?? item.address) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3 w-3" />
            {item.city}{item.address ? `, ${item.address}` : ""}
          </p>
        )}
        {item.description && (
          <p className="mt-2 line-clamp-2 text-sm text-slate-400">{item.description}</p>
        )}
        <div className="mt-auto pt-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-400">
            Онлайн-запись
          </span>
          <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-brand-400" />
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 animate-pulse">
      <div className="h-44 bg-slate-800" />
      <div className="p-4 space-y-2">
        <div className="h-4 w-2/3 rounded bg-slate-800" />
        <div className="h-3 w-1/2 rounded bg-slate-800" />
        <div className="h-3 w-full rounded bg-slate-800" />
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [activeChips, setActiveChips] = useState<string[]>([]);
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [locating, setLocating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

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
        <h1 className="text-3xl font-bold text-white">Найти nail-салон</h1>
        <p className="mt-1 text-slate-400">Онлайн-запись через Telegram — быстро и удобно</p>
      </div>

      {/* Search bar */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* Keyword */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Название салона или услуга..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            className="w-full rounded-xl bg-slate-900 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 ring-1 ring-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* City */}
        <div className="relative sm:w-48">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Город"
            value={city}
            list="cities-list"
            onChange={(e) => { setCity(e.target.value); setPage(1); }}
            className="w-full rounded-xl bg-slate-900 py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 ring-1 ring-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <datalist id="cities-list">
            {(citiesQuery.data ?? []).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* Locate */}
        <button
          onClick={locate}
          disabled={locating}
          title="Найти рядом"
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition ring-1 ${lat != null ? "bg-brand-500 text-white ring-brand-500 hover:bg-brand-600" : "bg-slate-900 text-slate-300 ring-slate-800 hover:bg-slate-800"}`}
        >
          <Locate className={`h-4 w-4 ${locating ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{lat != null ? "Рядом" : "Рядом"}</span>
        </button>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ring-1 transition ${showFilters ? "bg-slate-700 text-white ring-slate-600" : "bg-slate-900 text-slate-300 ring-slate-800 hover:bg-slate-800"}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Фильтры</span>
          {activeChips.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-white">
              {activeChips.length}
            </span>
          )}
        </button>
      </div>

      {/* Filter chips */}
      {showFilters && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SERVICE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              onClick={() => toggleChip(chip.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${activeChips.includes(chip.value)
                ? "bg-brand-500 text-white"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"}`}
            >
              {chip.label}
            </button>
          ))}
          {activeChips.length > 0 && (
            <button
              onClick={() => setActiveChips([])}
              className="flex items-center gap-1 rounded-full bg-slate-800 px-3.5 py-1.5 text-sm text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Сбросить
            </button>
          )}
        </div>
      )}

      {/* Active location badge */}
      {lat != null && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-500/15 px-3 py-1 text-sm text-brand-300">
          <Locate className="h-3.5 w-3.5" />
          Показаны салоны рядом с вами
          <button onClick={() => { setLat(undefined); setLng(undefined); }} className="ml-1 text-brand-400 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Results */}
      <div className="mt-8">
        {searchQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-20 flex flex-col items-center gap-4 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-900 text-4xl">🔍</div>
            <div>
              <p className="text-lg font-semibold text-white">Салоны не найдены</p>
              <p className="mt-1 text-sm text-slate-500">
                {query || city || activeChips.length > 0
                  ? "Попробуйте изменить фильтры или расширить поиск"
                  : "Пока нет публичных салонов в каталоге"}
              </p>
            </div>
            {(query || city || activeChips.length > 0) && (
              <button
                onClick={() => { setQuery(""); setCity(""); setActiveChips([]); setLat(undefined); setLng(undefined); }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white"
              >
                Сбросить все фильтры
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-500">
              Найдено: {items.length} {items.length === 1 ? "салон" : items.length < 5 ? "салона" : "салонов"}
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
                  className="rounded-xl bg-slate-800 px-6 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
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
