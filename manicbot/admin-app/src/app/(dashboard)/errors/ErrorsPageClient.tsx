"use client";

import { useMemo, useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import {
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  AlertOctagon,
  Search,
  X,
  Check,
  ChevronRight,
  ChevronDown,
  Filter,
} from "lucide-react";

type Severity = "fatal" | "error" | "warning";
type Source = "worker" | "admin-app" | "cron" | "edge" | "unknown";

type ErrorRow = {
  id: number;
  fingerprint: string;
  source: string;
  severity: string;
  message: string;
  stack: string | null;
  path: string | null;
  tenantId: string | null;
  userId: string | null;
  context: string | null;
  count: number;
  firstSeen: number;
  lastSeen: number;
  resolvedAt: number | null;
  createdAt: number;
};

const SEVERITY_OPTIONS: Array<{ value: Severity | ""; label: string }> = [
  { value: "", label: "All severities" },
  { value: "fatal", label: "Fatal" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
];

const SOURCE_OPTIONS: Array<{ value: Source | ""; label: string }> = [
  { value: "", label: "All sources" },
  { value: "worker", label: "Worker" },
  { value: "admin-app", label: "Admin app" },
  { value: "cron", label: "Cron" },
  { value: "edge", label: "Edge" },
  { value: "unknown", label: "Unknown" },
];

function severityBadge(severity: string) {
  if (severity === "fatal")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-300 bg-red-500/15 px-1.5 py-0.5 rounded-md border border-red-500/30 shrink-0">
        <AlertOctagon className="w-2.5 h-2.5" /> FATAL
      </span>
    );
  if (severity === "error")
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-300 bg-orange-500/15 px-1.5 py-0.5 rounded-md border border-orange-500/30 shrink-0">
        <AlertCircle className="w-2.5 h-2.5" /> ERROR
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded-md border border-amber-500/30 shrink-0">
      <AlertTriangle className="w-2.5 h-2.5" /> WARN
    </span>
  );
}

function rowAccent(severity: string, resolved: boolean): string {
  if (resolved) return "opacity-60";
  if (severity === "fatal") return "border-l-[3px] border-red-500 bg-red-950/20";
  if (severity === "error") return "border-l-[3px] border-orange-500 bg-orange-950/15";
  return "border-l-[3px] border-amber-500 bg-amber-950/10";
}

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function ErrorEventRow({
  ev,
  onResolve,
  resolving,
}: {
  ev: ErrorRow;
  onResolve: (id: number) => void;
  resolving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const resolved = ev.resolvedAt !== null;

  return (
    <div
      className={`border-b border-slate-200 dark:border-slate-800/50 last:border-0 transition-colors ${rowAccent(ev.severity, resolved)}`}
    >
      <div
        className="flex items-start gap-2 py-2.5 px-3 cursor-pointer hover:bg-white/[0.02]"
        onClick={() => setExpanded((v) => !v)}
      >
        <button
          className="text-slate-500 dark:text-slate-400 shrink-0 pt-0.5"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        {severityBadge(ev.severity)}
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700/60 text-slate-500 dark:text-slate-300 shrink-0">
          {ev.source}
        </span>
        <span className="text-xs flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">
          {ev.message}
        </span>
        {ev.path && (
          <span className="text-[10px] text-slate-500 font-mono shrink-0 hidden md:block truncate max-w-[160px]">
            {ev.path}
          </span>
        )}
        {ev.tenantId && (
          <span className="text-[9px] text-slate-500 font-mono shrink-0 hidden lg:block truncate max-w-[100px]">
            {ev.tenantId}
          </span>
        )}
        <span className="text-[10px] text-slate-500 tabular-nums shrink-0 pt-0.5">
          ×{ev.count}
        </span>
        <span className="text-[10px] text-slate-500 tabular-nums shrink-0 pt-0.5 w-10 text-right">
          {relativeTime(ev.lastSeen)}
        </span>
        {!resolved && (
          <button
            disabled={resolving}
            onClick={(e) => {
              e.stopPropagation();
              onResolve(ev.id);
            }}
            className="ml-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50 shrink-0"
            title="Mark resolved"
          >
            <Check className="w-3 h-3 inline -mt-0.5" />
          </button>
        )}
        {resolved && (
          <span className="ml-1 text-[10px] font-semibold text-emerald-400 shrink-0">
            ✓
          </span>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[10px] text-slate-500 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <div className="font-semibold text-slate-400">Fingerprint</div>
              <div className="font-mono">{ev.fingerprint}</div>
            </div>
            <div>
              <div className="font-semibold text-slate-400">First seen</div>
              <div>{new Date(ev.firstSeen * 1000).toLocaleString()}</div>
            </div>
            <div>
              <div className="font-semibold text-slate-400">Last seen</div>
              <div>{new Date(ev.lastSeen * 1000).toLocaleString()}</div>
            </div>
            <div>
              <div className="font-semibold text-slate-400">User</div>
              <div className="font-mono">{ev.userId ?? "—"}</div>
            </div>
          </div>
          {ev.stack && (
            <pre className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900/80 rounded-xl p-3 overflow-x-auto border border-slate-200 dark:border-slate-800/50 scrollbar-none whitespace-pre-wrap">
              {ev.stack}
            </pre>
          )}
          {ev.context && (
            <pre className="text-[10px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900/80 rounded-xl p-3 overflow-x-auto border border-slate-200 dark:border-slate-800/50 scrollbar-none">
              {ev.context}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function ErrorsPageClient() {
  const [severity, setSeverity] = useState<Severity | "">("");
  const [source, setSource] = useState<Source | "">("");
  const [tenantId, setTenantId] = useState("");
  const [search, setSearch] = useState("");
  const [resolved, setResolved] = useState<"all" | "open" | "done">("open");

  const filterArgs = useMemo(
    () => ({
      severity: severity || undefined,
      source: source || undefined,
      tenantId: tenantId.trim() || undefined,
      search: search.trim() || undefined,
      resolved:
        resolved === "all" ? undefined : resolved === "open" ? false : true,
      limit: 100,
      offset: 0,
    }),
    [severity, source, tenantId, search, resolved],
  );

  const listQuery = api.errorEvents.list.useQuery(filterArgs, {
    refetchInterval: 30_000,
  });
  const statsQuery = api.errorEvents.stats.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const utils = api.useUtils();
  const resolveMut = api.errorEvents.resolve.useMutation({
    onSuccess: () => {
      void utils.errorEvents.list.invalidate();
      void utils.errorEvents.stats.invalidate();
    },
  });

  const rows = (listQuery.data?.rows ?? []) as ErrorRow[];
  const total = listQuery.data?.total ?? 0;
  const stats = statsQuery.data;
  const hasAnyFilter = !!(severity || source || tenantId || search || resolved !== "open");

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Errors</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Custom error monitoring — fatals, errors, warnings across all sources.
            </p>
          </div>
          <button
            onClick={() => {
              void listQuery.refetch();
              void statsQuery.refetch();
            }}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw
              className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${listQuery.isFetching ? "animate-spin" : ""}`}
            />
          </button>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="glass-card rounded-xl p-3 text-center">
            <div className="text-lg font-bold text-slate-200">
              {stats?.last24h.total ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Total today</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div
              className={`text-lg font-bold ${(stats?.last24h.fatal ?? 0) > 0 ? "text-red-400" : "text-slate-500"}`}
            >
              {stats?.last24h.fatal ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Fatal (24h)</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div
              className={`text-lg font-bold ${(stats?.last24h.error ?? 0) > 0 ? "text-orange-400" : "text-slate-500"}`}
            >
              {stats?.last24h.error ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Errors (24h)</div>
          </div>
          <div className="glass-card rounded-xl p-3 text-center">
            <div
              className={`text-lg font-bold ${(stats?.last24h.warning ?? 0) > 0 ? "text-amber-400" : "text-slate-500"}`}
            >
              {stats?.last24h.warning ?? 0}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Warnings (24h)</div>
          </div>
        </div>

        {/* Filters */}
        <div className="glass-card rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity | "")}
            className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source | "")}
            className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={resolved}
            onChange={(e) => setResolved(e.target.value as "all" | "open" | "done")}
            className="bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white"
          >
            <option value="open">Unresolved</option>
            <option value="done">Resolved</option>
            <option value="all">All</option>
          </select>
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="tenantId..."
            className="w-32 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-1.5 text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white placeholder-slate-600"
          />
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-600 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="message / path"
              className="pl-7 pr-3 py-1.5 w-40 sm:w-56 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700/50 rounded-xl text-xs outline-none focus:border-brand-500/60 text-slate-900 dark:text-white placeholder-slate-600"
            />
          </div>
          {hasAnyFilter && (
            <button
              onClick={() => {
                setSeverity("");
                setSource("");
                setTenantId("");
                setSearch("");
                setResolved("open");
              }}
              className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              title="Reset filters"
            >
              <X className="w-3 h-3 text-slate-500 dark:text-slate-400" />
            </button>
          )}
        </div>

        {/* List */}
        <div className="glass-card rounded-2xl overflow-hidden">
          {listQuery.isLoading ? (
            <div className="divide-y divide-slate-200 dark:divide-slate-800/50">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 py-3 px-3 animate-pulse">
                  <div className="w-3 h-3 rounded-full bg-slate-100 dark:bg-slate-800 shrink-0" />
                  <div className="w-14 h-4 rounded-md bg-slate-100 dark:bg-slate-800 shrink-0" />
                  <div className="w-16 h-4 rounded-md bg-slate-100 dark:bg-slate-800/70 shrink-0" />
                  <div className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800/50" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-slate-500">No errors found.</p>
              <p className="text-[11px] text-slate-600 mt-1">
                {hasAnyFilter
                  ? "Try changing the filters."
                  : "All quiet — nothing in this window."}
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800/50 bg-white dark:bg-slate-900/30">
                <span className="text-[10px] text-slate-600 font-medium">
                  {rows.length} of {total}
                </span>
                {listQuery.isFetching && (
                  <span className="text-[10px] text-brand-500/70 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" /> refreshing
                  </span>
                )}
              </div>
              {rows.map((ev) => (
                <ErrorEventRow
                  key={ev.id}
                  ev={ev}
                  onResolve={(id) => resolveMut.mutate({ id })}
                  resolving={resolveMut.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
