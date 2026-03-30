"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { RefreshCw, Trash2, AlertCircle, AlertTriangle, Info, Filter, X } from "lucide-react";

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
  return "bg-slate-700/50 text-slate-300 border-slate-600/30";
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
    <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded-md border border-slate-700/50 shrink-0">
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

function EventRow({ event }: { event: AdminEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = event.data && Object.keys(event.data).length > 0;

  return (
    <div
      className={`border-b border-slate-800/50 last:border-0 transition-colors ${hasData ? "cursor-pointer hover:bg-white/[0.02]" : ""}`}
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
        <span className="text-xs text-slate-300 flex-1 min-w-0 truncate">{event.message}</span>
        {/* tenantId if present */}
        {event.tenantId && (
          <span className="text-[9px] text-slate-600 font-mono shrink-0 hidden sm:block truncate max-w-[80px]">
            {event.tenantId}
          </span>
        )}
      </div>
      {expanded && event.data && (
        <div className="px-3 pb-3">
          <pre className="text-[10px] text-slate-400 bg-slate-900/80 rounded-xl p-3 overflow-x-auto border border-slate-800/50 scrollbar-none">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

const TYPE_PRESETS = [
  "booking",
  "webhook",
  "stripe",
  "auth",
  "error",
  "channel",
];

export default function EventsPageClient() {
  const [typeFilter, setTypeFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [clearPending, setClearPending] = useState(false);

  const { data, isLoading, isFetching, refetch } = api.events.getRecent.useQuery(
    { limit: 200, type: typeFilter || undefined, tenantId: tenantFilter || undefined },
    { refetchInterval: 10_000 }
  );

  const clearMut = api.events.clear.useMutation({
    onSuccess: () => {
      setClearPending(false);
      void refetch();
    },
    onSettled: () => setClearPending(false),
  });

  const events = (data?.events ?? []) as AdminEvent[];

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Event Log</h1>
            <p className="text-xs text-slate-400 mt-1">
              Поток событий платформы · обновляется каждые 10с
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => void refetch()}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors"
              title="Обновить"
            >
              <RefreshCw className={`w-4 h-4 text-slate-400 ${isFetching ? "animate-spin" : ""}`} />
            </button>
            {clearPending ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-red-400">Удалить все?</span>
                <button
                  onClick={() => clearMut.mutate()}
                  disabled={clearMut.isPending}
                  className="px-3 py-1.5 rounded-xl bg-red-500/20 text-red-400 text-xs font-semibold border border-red-500/30 hover:bg-red-500/30 transition-colors"
                >
                  Да
                </button>
                <button
                  onClick={() => setClearPending(false)}
                  className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setClearPending(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Очистить
              </button>
            )}
          </div>
        </div>

        {/* Filter bar */}
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
                    : "bg-slate-800/50 text-slate-500 border-slate-700/50 hover:border-slate-600"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            placeholder="tenantId..."
            className="ml-auto w-32 sm:w-44 bg-slate-900/70 border border-slate-700/50 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-brand-500/60 text-white placeholder-slate-600"
          />
          {(typeFilter || tenantFilter) && (
            <button
              onClick={() => { setTypeFilter(""); setTenantFilter(""); }}
              className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
            >
              <X className="w-3 h-3 text-slate-400" />
            </button>
          )}
        </div>

        {/* Event list */}
        <div className="glass-card rounded-2xl overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-slate-800/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-3 px-3 animate-pulse">
                  <div className="w-7 h-2.5 rounded-full bg-slate-800 shrink-0" />
                  <div className="w-10 h-4 rounded-md bg-slate-800 shrink-0" />
                  <div className="w-20 h-4 rounded-md bg-slate-800/70 shrink-0" />
                  <div className="flex-1 h-2.5 rounded-full bg-slate-800/50" />
                </div>
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-slate-500">Нет событий</p>
              <p className="text-[11px] text-slate-600 mt-1">
                {typeFilter || tenantFilter ? "Попробуйте изменить фильтры" : "События появятся когда Worker начнёт их логировать"}
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/50 bg-slate-900/30">
                <span className="text-[10px] text-slate-600 font-medium">
                  {events.length} событи{events.length === 1 ? "е" : "й"}
                </span>
                {isFetching && (
                  <span className="text-[10px] text-brand-500/70 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" /> обновляется...
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
