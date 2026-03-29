"use client";

import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Download, TrendingUp, CheckCircle, Clock } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  trialing: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  grace_period: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  inactive: "text-slate-400 bg-slate-700/20 border-slate-600/20",
};

const PLAN_COLORS: Record<string, string> = {
  start: "text-slate-300 bg-slate-700/40",
  pro: "text-brand-400 bg-brand-500/10",
  studio: "text-purple-400 bg-purple-500/10",
};

function downloadCSV(data: string, filename: string) {
  const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BillingPageClient() {
  const { data, isLoading } = api.billing.getOverview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const exportQuery = api.export.revenue.useQuery({ format: "csv" }, { enabled: false });

  const handleExport = async () => {
    const res = await exportQuery.refetch();
    if (res.data) downloadCSV(res.data.data, res.data.filename);
  };

  const m = data?.metrics;
  const tenants = data?.tenants ?? [];

  return (
    <Shell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Billing</h1>
            <p className="text-xs text-slate-400 mt-1">Подписки и финансы</p>
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-white px-3 py-2 text-xs font-medium rounded-xl transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>

        {/* Metrics */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card rounded-2xl p-4 col-span-2 flex items-center gap-4">
              <TrendingUp className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-slate-400">MRR (расчётный)</p>
                <p className="text-3xl font-extrabold text-white">${m?.mrr ?? 0}</p>
              </div>
            </div>
            <div className="glass-card rounded-2xl p-4 text-center">
              <CheckCircle className="w-5 h-5 text-brand-400 mx-auto mb-1.5" />
              <p className="text-2xl font-bold text-white">{m?.activeSubscribers ?? 0}</p>
              <p className="text-[10px] text-slate-400">Активных</p>
            </div>
            <div className="glass-card rounded-2xl p-4 text-center">
              <Clock className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
              <p className="text-2xl font-bold text-white">{m?.trialing ?? 0}</p>
              <p className="text-[10px] text-slate-400">На триале</p>
            </div>
          </div>
        )}

        {/* Plan breakdown */}
        {m?.planBreakdown && Object.keys(m.planBreakdown).length > 0 && (
          <div className="glass-card rounded-2xl p-4">
            <p className="text-xs font-semibold text-slate-400 mb-3">Планы (активные)</p>
            <div className="flex gap-3">
              {Object.entries(m.planBreakdown).map(([plan, count]) => (
                <div key={plan} className="flex-1 text-center bg-slate-800/50 rounded-xl p-3">
                  <p className="text-lg font-bold text-white">{count}</p>
                  <p className={`text-[10px] font-bold uppercase mt-0.5 ${PLAN_COLORS[plan] ?? ""}`}>
                    {plan}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tenants list */}
        <div className="space-y-2.5">
          <p className="text-xs font-semibold text-slate-400">Все тенанты</p>
          {tenants.map((t) => (
            <div key={t.id} className="glass-card rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{t.name}</p>
                  {t.email && (
                    <p className="text-[11px] text-slate-400 mt-0.5 truncate">{t.email}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase ${
                      STATUS_COLORS[t.billingStatus] ?? STATUS_COLORS.inactive
                    }`}
                  >
                    {t.billingStatus}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                      PLAN_COLORS[t.plan] ?? PLAN_COLORS.start
                    }`}
                  >
                    {t.plan}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border/30">
                <span className="text-[10px] font-mono text-slate-600 truncate flex-1">{t.id}</span>
                <span className="text-sm font-bold text-white shrink-0 ml-2">
                  {t.monthlyRevenue > 0 ? `$${t.monthlyRevenue}/м` : "—"}
                </span>
              </div>
            </div>
          ))}

          {tenants.length === 0 && !isLoading && (
            <div className="glass-card rounded-2xl py-12 text-center">
              <p className="text-slate-500 text-sm">Нет данных</p>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
