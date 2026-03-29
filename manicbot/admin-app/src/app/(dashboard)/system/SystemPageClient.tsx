"use client";

import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Activity, Database, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";

export default function SystemPageClient() {
  const {
    data: health,
    isLoading: hLoading,
    refetch: refetchHealth,
    isFetching: hFetching,
  } = api.system.getHealth.useQuery(undefined, { refetchInterval: 30_000 });
  const {
    data: tableStats,
    isLoading: tLoading,
    refetch: refetchTables,
    isFetching: tFetching,
  } = api.system.getTableStats.useQuery(undefined, { refetchInterval: 60_000 });

  const isOk = health?.status === "ok";
  const isFetching = hFetching || tFetching;

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">System</h1>
            <p className="text-xs text-slate-400 mt-1">Состояние D1 и инфраструктуры</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void refetchHealth(); void refetchTables(); }}
              className="p-2 rounded-xl bg-slate-800 active:bg-slate-700 text-slate-300 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
            <div
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border ${
                isOk
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
            >
              {isOk ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {isOk ? "OK" : "Error"}
            </div>
          </div>
        </div>

        {/* Health cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="glass-card rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-brand-400" />
              <p className="text-[11px] text-slate-400">D1 Database</p>
            </div>
            {hLoading ? (
              <div className="h-7 animate-pulse bg-slate-800/30 rounded" />
            ) : (
              <>
                <div className={`text-xl font-bold ${health?.dbConnected ? "text-emerald-400" : "text-red-400"}`}>
                  {health?.dbConnected ? "Connected" : "Error"}
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Latency: {health?.dbLatencyMs ?? "—"}ms
                </p>
              </>
            )}
          </div>

          <div className="glass-card rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-purple-400" />
              <p className="text-[11px] text-slate-400">Всего строк</p>
            </div>
            {tLoading ? (
              <div className="h-7 animate-pulse bg-slate-800/30 rounded" />
            ) : (
              <div className="text-xl font-bold text-white">
                {(tableStats?.totalRows ?? 0).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Table stats */}
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-sm font-bold text-white">Таблицы D1</h2>
          </div>
          {tLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse bg-slate-800/30 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {(tableStats?.tables ?? []).map((t) => {
                const pct =
                  tableStats && tableStats.totalRows > 0
                    ? Math.round((t.rows / tableStats.totalRows) * 100)
                    : 0;
                return (
                  <div key={t.table} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-xs font-mono text-slate-400 w-32 shrink-0 truncate">
                      {t.table}
                    </span>
                    <div className="flex-1">
                      <div className="w-full bg-slate-800 rounded-full h-1.5">
                        <div
                          className="bg-brand-500 h-1.5 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-white w-12 text-right shrink-0">
                      {t.rows === -1 ? (
                        <span className="text-red-400 text-xs">err</span>
                      ) : (
                        t.rows.toLocaleString()
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stack info */}
        <div className="glass-card rounded-2xl p-4">
          <h2 className="text-sm font-bold text-white mb-3">Стек</h2>
          <div className="grid grid-cols-1 gap-2">
            {[
              { label: "Runtime", value: "Cloudflare Workers (Edge)" },
              { label: "Database", value: "Cloudflare D1 (SQLite)" },
              { label: "ORM", value: "Drizzle ORM" },
              { label: "Framework", value: "Next.js 15 (App Router)" },
              { label: "API", value: "tRPC v11" },
              { label: "Деплой", value: "Cloudflare Pages" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/30">
                <span className="text-xs text-slate-400">{label}</span>
                <span className="text-xs text-slate-200 font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
