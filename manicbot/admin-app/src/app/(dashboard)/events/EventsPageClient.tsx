"use client";

import { useState, useMemo } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { RefreshCw, Trash2, AlertCircle, AlertTriangle, Info, Filter, X, Search, Wrench } from "lucide-react";

type EventLevel = "info" | "warn" | "error";
type AdminEvent = {
  id: string;
  ts: number;
  type: string;
  level: EventLevel;
  message: string;
  tenantId?: string;
  botId?: string;
  data?: Record<string, unknown>;
};

// Color coding by type prefix
function getTypeStyle(type: string): string {
  if (type.startsWith("error")) return "bg-red-500/15 text-red-300 border-red-500/20";
  if (type.startsWith("booking")) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/20";
  if (type.startsWith("auth")) return "bg-violet-500/15 text-violet-300 border-violet-500/20";
  if (type.startsWith("webhook")) return "bg-blue-500/15 text-blue-300 border-blue-500/20";
  if (type.startsWith("stripe")) return "bg-cyan-500/15 text-cyan-300 border-cyan-500/20";
  if (type.startsWith("channel")) return "bg-amber-500/15 text-amber-300 border-amber-500/20";
  return "bg-slate-200 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600/30";
}

function LevelBadge({ level }: { level: EventLevel }) {
  if (level === "error")
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-md border border-red-500/20 shrink-0">
        <AlertCircle className="w-2.5 h-2.5" /> ERR
      </span>
    );
  if (level === "warn")
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-md border border-amber-500/20 shrink-0">
        <AlertTriangle className="w-2.5 h-2.5" /> WARN
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700/50 shrink-0">
      <Info className="w-2.5 h-2.5" /> INFO
    </span>
  );
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}с`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч`;
  return `${Math.floor(diff / 86400)}д`;
}

function rowAccent(level: EventLevel): string {
  if (level === "error") return "border-l-[3px] border-red-500 bg-red-950/25";
  if (level === "warn") return "border-l-[3px] border-amber-500 bg-amber-950/15";
  return "";
}

function EventRow({ event }: { event: AdminEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = event.data && Object.keys(event.data).length > 0;

  return (
    <div
      className={`border-b border-slate-200 dark:border-slate-800/50 last:border-0 transition-colors ${rowAccent(event.level)} ${hasData ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
      onClick={() => hasData && setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2 py-2.5 px-3">
        {/* timestamp */}
        <span className="text-[10px] text-slate-600 tabular-nums shrink-0 pt-0.5 w-7 text-right">
          {relativeTime(event.ts)}
        </span>
        {/* level badge */}
        <LevelBadge level={event.level} />
        {/* type chip */}
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${getTypeStyle(event.type)}`}>
          {event.type}
        </span>
        {/* message */}
        <span className={`text-xs flex-1 min-w-0 truncate ${event.level === "error" ? "text-red-200" : event.level === "warn" ? "text-amber-200" : "text-slate-600 dark:text-slate-300"}`}>
          {event.message}
        </span>
        {/* tenantId if present */}
        {event.tenantId && (
          <span className="text-[9px] text-slate-600 font-mono shrink-0 hidden sm:block truncate max-w-[80px]">
            {event.tenantId}
          </span>
        )}
      </div>
      {expanded && event.data && (
        <div className="px-3 pb-3">
          <pre className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900/80 rounded-xl p-3 overflow-x-auto border border-slate-200 dark:border-slate-800/50 scrollbar-none">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const TYPE_PRESETS = ["booking", "webhook", "stripe", "auth", "error", "channel"];

const getLevelFilters = (lang: Lang) => [
  { value: "" as const, label: t("gmEvents.filterAll", lang), cls: "text-slate-500 border-slate-200 dark:border-slate-700/50 bg-slate-100 dark:bg-slate-800/50 hover:border-slate-600" },
  { value: "error" as const, label: t("gmEvents.filterErrors", lang), cls: "text-red-400 border-red-500/40 bg-red-500/10 hover:bg-red-500/20" },
  { value: "warn" as const, label: t("gmEvents.filterWarns", lang), cls: "text-amber-400 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20" },
  { value: "info" as const, label: t("gmEvents.filterInfo", lang), cls: "text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600/50 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-700/50" },
];

export default function EventsPageClient() {
  const { lang } = useLang();
  const LEVEL_FILTERS = getLevelFilters(lang);
  const [typeFilter, setTypeFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState<"" | EventLevel>("");
  const [textSearch, setTextSearch] = useState("");
  const [clearPending, setClearPending] = useState(false);

  const { data, isLoading, isFetching, refetch } = api.events.getRecent.useQuery(
    { limit: 500, type: typeFilter || undefined, tenantId: tenantFilter || undefined },
    { refetchInterval: 10_000 },
  );

  const clearMut = api.events.clear.useMutation({
    onSuccess: () => {
      setClearPending(false);
      void refetch();
    },
    onSettled: () => setClearPending(false),
  });

  const allEvents = (data?.events ?? []) as AdminEvent[];

  // Stats computed from server-loaded events (before client filters)
  const stats = useMemo(() => {
    const errors = allEvents.filter((e) => e.level === "error").length;
    const warns = allEvents.filter((e) => e.level === "warn").length;
    const infos = allEvents.filter((e) => e.level === "info").length;
    return { total: allEvents.length, errors, warns, infos };
  }, [allEvents]);

  // Client-side filtering by level + text
  const events = useMemo(() => {
    let list = allEvents;
    if (levelFilter) list = list.filter((e) => e.level === levelFilter);
    if (textSearch.trim()) {
      const q = textSearch.toLowerCase();
      list = list.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          (e.tenantId ?? "").toLowerCase().includes(q) ||
          (e.data ? JSON.stringify(e.data).toLowerCase().includes(q) : false),
      );
    }
    return list;
  }, [allEvents, levelFilter, textSearch]);

  const hasAnyFilter = !!(typeFilter || tenantFilter || levelFilter || textSearch);

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">{t("gmEvents.title", lang)}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {t("gmEvents.subtitleFull", lang)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void refetch()}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              title={t("gmEvents.refreshTitle", lang)}
            >
              <RefreshCw className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${isFetching ? "animate-spin" : ""}`} />
            </button>
            {clearPending ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-400">{t("gmEvents.deleteAll", lang)}</span>
                <button
                  onClick={() => clearMut.mutate()}
                  disabled={clearMut.isPending}
                  className="px-3 py-1.5 rounded-xl bg-red-500/20 text-red-400 text-xs font-semibold border border-red-500/30 hover:bg-red-500/30 transition-colors"
                >
                  {t("gmEvents.confirmYes", lang)}
                </button>
                <button
                  onClick={() => setClearPending(false)}
                  className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setClearPending(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-red-900/30 text-slate-500 dark:text-slate-400 hover:text-red-400 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t("gmEvents.clearBtn", lang)}
              </button>
            )}
          </div>
        </div>

        {/* Stats bar */}
        {!isLoading && allEvents.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-slate-200">{stats.total}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{t("gmEvents.totalLabel", lang)}</div>
            </div>
            <button
              onClick={() => setLevelFilter(levelFilter === "error" ? "" : "error")}
              className={`glass-card rounded-xl p-3 text-center transition-colors ${levelFilter === "error" ? "ring-1 ring-red-500/50" : "hover:bg-white/[0.02]"}`}
            >
              <div className={`text-lg font-bold ${stats.errors > 0 ? "text-red-400" : "text-slate-500"}`}>
                {stats.errors}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{t("gmEvents.errorsLabel", lang)}</div>
            </button>
            <button
              onClick={() => setLevelFilter(levelFilter === "warn" ? "" : "warn")}
              className={`glass-card rounded-xl p-3 text-center transition-colors ${levelFilter === "warn" ? "ring-1 ring-amber-500/50" : "hover:bg-white/[0.02]"}`}
            >
              <div className={`text-lg font-bold ${stats.warns > 0 ? "text-amber-400" : "text-slate-500"}`}>
                {stats.warns}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{t("gmEvents.warnsLabel", lang)}</div>
            </button>
            <div className="glass-card rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-slate-400">{stats.infos}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{t("gmEvents.infoLabel", lang)}</div>
            </div>
          </div>
        )}

        {/* Level filter */}
        <div className="flex flex-wrap gap-1.5">
          {LEVEL_FILTERS.map(({ value, label, cls }) => (
            <button
              key={value || "all"}
              onClick={() => setLevelFilter(value)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
                levelFilter === value
                  ? value === "error"
                    ? "text-red-300 border-red-500/50 bg-red-500/15"
                    : value === "warn"
                    ? "text-amber-300 border-amber-500/50 bg-amber-500/15"
                    : value === "info"
                    ? "text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-500/50 bg-slate-100 dark:bg-slate-700/50"
                    : "text-slate-900 dark:text-white border-slate-200 dark:border-slate-500 bg-slate-100 dark:bg-slate-700"
                  : cls
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Type filter + search row */}
        <div className="glass-card rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <div className="flex flex-wrap gap-1.5">
            {TYPE_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setTypeFilter(typeFilter === preset ? "" : preset)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border font-mono transition-colors ${
                  typeFilter === preset
                    ? getTypeStyle(preset) + " font-semibold"
                    : "bg-slate-100 dark:bg-slate-800/50 text-slate-500 border-slate-200 dark:border-slate-700/50 hover:border-slate-600"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Text search */}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600 pointer-events-none" />
              <input
                type="text"
                value={textSearch}
                onChange={(e) => setTextSearch(e.target.value)}
                placeholder={t("gmEvents.searchPh", lang)}
                className="pl-7 pr-3 py-1.5 w-36 sm:w-48 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white placeholder-slate-600"
              />
            </div>
            <input
              type="text"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              placeholder="tenantId..."
              className="w-28 sm:w-36 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white placeholder-slate-600"
            />
          </div>

          {hasAnyFilter && (
            <button
              onClick={() => {
                setTypeFilter("");
                setTenantFilter("");
                setLevelFilter("");
                setTextSearch("");
              }}
              className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              title={t("gmEvents.resetFiltersTitle", lang)}
            >
              <X className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            </button>
          )}
        </div>

        {/* Event list */}
        <div className="glass-card rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-800/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-3 px-3 animate-pulse">
                  <div className="w-7 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" />
                  <div className="w-10 h-4 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0" />
                  <div className="w-20 h-4 rounded-md bg-slate-100 dark:bg-slate-800/70 shrink-0" />
                  <div className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800/50" />
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            hasAnyFilter ? (
              <div className="py-16 text-center">
                <p className="text-sm text-slate-500">{t("gmEvents.noEvents", lang)}</p>
                <p className="text-[11px] text-slate-600 mt-1">{t("gmEvents.tryChangeFilters", lang)}</p>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="flex items-start gap-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
                    <Wrench className="h-5 w-5 text-blue-400" />
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Events configuration required
                      </h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        To display platform events, the admin-app needs to know the Worker URL and admin
                        key. Set these environment variables in the Cloudflare Pages dashboard for the{" "}
                        <span className="font-medium text-slate-700 dark:text-slate-300">admin-app</span>{" "}
                        project:
                      </p>
                    </div>
                    <div className="rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-mono font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                          WORKER_PUBLIC_URL
                        </code>
                        <span className="text-[11px] text-slate-500">
                          — public URL of your Worker (e.g. https://manicbot.your-subdomain.workers.dev)
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-mono font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                          ADMIN_KEY
                        </code>
                        <span className="text-[11px] text-slate-500">
                          — the same ADMIN_KEY secret configured on the Worker
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-500">
                      After setting the variables, redeploy the Pages project. Events will appear once
                      the Worker starts logging them.
                    </p>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800/50 bg-white dark:bg-slate-900/30">
                <span className="text-[10px] text-slate-600 font-medium">
                  {events.length} {events.length === 1 ? t("gmEvents.eventSuffixOne", lang) : t("gmEvents.eventsSuffix", lang)}
                  {allEvents.length !== events.length && (
                    <span className="text-slate-700"> / {allEvents.length} {t("gmEvents.totalSuffix", lang)}</span>
                  )}
                </span>
                {isFetching && (
                  <span className="text-[10px] text-brand-500/70 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" /> {t("gmEvents.refreshing", lang)}
                  </span>
                )}
              </div>
              <div>
                {events.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
