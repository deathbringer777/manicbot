"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { OverviewChart } from "~/components/dashboard/OverviewChart";
import {
  Users,
  Building2,
  TrendingUp,
  CalendarDays,
  CreditCard,
  Clock,
} from "lucide-react";

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <div className={`glass-card rounded-2xl p-4 relative overflow-hidden border ${accent}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 truncate">{title}</p>
          <p className="text-2xl font-extrabold text-white mt-1 tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <div className="shrink-0 ml-2 opacity-60">
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

const PERIODS = [
  { label: "7д", days: 7 },
  { label: "30д", days: 30 },
  { label: "90д", days: 90 },
];

export default function DashboardClient() {
  const [period, setPeriod] = useState(30);

  const { data: stats, isLoading } = api.metrics.getDashboardStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: chart } = api.metrics.getChartData.useQuery({ days: period });

  const s = stats;

  return (
    <Shell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-xs text-slate-400 mt-1">Метрики платформы в реальном времени</p>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-card rounded-2xl p-4 h-20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              title="Пользователи"
              value={s?.totalUsers ?? 0}
              icon={Users}
              accent="border-brand-500/20"
            />
            <StatCard
              title="Салоны"
              value={s?.totalTenants ?? 0}
              sub={`${s?.trialingCount ?? 0} на триале`}
              icon={Building2}
              accent="border-purple-500/20"
            />
            <StatCard
              title="Подписки"
              value={s?.activeSubscriptions ?? 0}
              icon={CreditCard}
              accent="border-emerald-500/20"
            />
            <StatCard
              title="MRR"
              value={`$${s?.mrr ?? 0}`}
              sub="расчётный"
              icon={TrendingUp}
              accent="border-amber-500/20"
            />
            <StatCard
              title="Всего записей"
              value={s?.totalAppointments ?? 0}
              icon={CalendarDays}
              accent="border-cyan-500/20"
            />
            <StatCard
              title="Сегодня"
              value={s?.todayAppointments ?? 0}
              sub="записей"
              icon={Clock}
              accent="border-rose-500/20"
            />
          </div>
        )}

        {/* Chart */}
        <div className="glass-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Записи по дням</h2>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => setPeriod(p.days)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    period === p.days
                      ? "bg-brand-500/20 text-brand-400"
                      : "text-slate-400 hover:bg-slate-800 active:bg-slate-700"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <OverviewChart data={chart ?? []} />
        </div>

        {/* Recent activity */}
        <div className="glass-card rounded-2xl p-4">
          <h2 className="text-sm font-bold text-white mb-3">Последняя активность</h2>
          <div className="space-y-3">
            {(s?.recentActivity ?? []).map((a, i) => (
              <div
                key={a.id + i}
                className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0"
              >
                <div className="h-8 w-8 shrink-0 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-400 text-xs font-bold">
                  {a.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{a.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{a.action}</p>
                </div>
                <span className="text-[10px] text-slate-600 shrink-0">{a.time}</span>
              </div>
            ))}
            {!isLoading && (s?.recentActivity ?? []).length === 0 && (
              <p className="text-xs text-slate-500 py-4 text-center">Нет активности</p>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
