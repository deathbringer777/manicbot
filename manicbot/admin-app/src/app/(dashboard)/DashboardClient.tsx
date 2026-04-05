"use client";

import { useState, useMemo } from "react";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { OverviewChart } from "~/components/dashboard/OverviewChart";
import { ReferralSignupCharts } from "~/components/dashboard/ReferralSignupCharts";
import {
  Users,
  Building2,
  TrendingUp,
  CalendarDays,
  CreditCard,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatPlnWhole } from "~/lib/money";

// ─── Color palette ────────────────────────────────────────────────

const STAT_COLORS = {
  violet: {
    iconBg: "bg-violet-500/15",
    iconColor: "text-violet-400",
    topBar: "from-violet-500/80 via-violet-400/30 to-transparent",
  },
  cyan: {
    iconBg: "bg-cyan-500/15",
    iconColor: "text-cyan-400",
    topBar: "from-cyan-500/80 via-cyan-400/30 to-transparent",
  },
  emerald: {
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-400",
    topBar: "from-emerald-500/80 via-emerald-400/30 to-transparent",
  },
  amber: {
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-400",
    topBar: "from-amber-500/80 via-amber-400/30 to-transparent",
  },
  pink: {
    iconBg: "bg-pink-500/15",
    iconColor: "text-pink-400",
    topBar: "from-pink-500/80 via-pink-400/30 to-transparent",
  },
  blue: {
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-400",
    topBar: "from-blue-500/80 via-blue-400/30 to-transparent",
  },
} as const;

// ─── StatCard ─────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  iconBg,
  iconColor,
  topBar,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  topBar: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4 relative overflow-hidden">
      {/* 2px gradient top bar */}
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${topBar}`} />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 truncate">{title}</p>
          <p className="text-2xl font-extrabold text-white mt-1 tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <div className={`shrink-0 ml-2 w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
}

// ─── StatCardSkeleton ─────────────────────────────────────────────

function StatCardSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-4 relative overflow-hidden animate-pulse">
      {/* top bar placeholder */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-slate-700/60" />
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="h-3 w-20 bg-slate-700/60 rounded mb-2" />
          <div className="h-7 w-14 bg-slate-700/60 rounded" />
        </div>
        <div className="shrink-0 ml-2 w-10 h-10 rounded-xl bg-slate-700/60" />
      </div>
    </div>
  );
}

// ─── Period switcher ──────────────────────────────────────────────

const PERIODS = [
  { label: "7д", days: 7 },
  { label: "30д", days: 30 },
  { label: "90д", days: 90 },
];

// ─── MiniCalendar ─────────────────────────────────────────────────

const WEEKDAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function MiniCalendar({ data }: { data: { date: string; appointments: number }[] }) {
  const [viewDate, setViewDate] = useState(() => new Date());

  const dayMap = useMemo(() => {
    const m: Record<string, number> = {};
    data.forEach((d) => { m[d.date] = (m[d.date] ?? 0) + d.appointments; });
    return m;
  }, [data]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const fmtISO = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const monthLabel = viewDate.toLocaleString("default", { month: "long", year: "numeric" });

  const maxCount = Math.max(1, ...Object.values(dayMap));

  return (
    <div className="glass-card rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-white capitalize">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewDate(new Date(year, month - 1))}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewDate(new Date())}
            className="px-2 py-0.5 rounded-lg text-[10px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
          >
            сейчас
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month + 1))}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-slate-500 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;
          const iso = fmtISO(day);
          const count = dayMap[iso] ?? 0;
          const intensity = count > 0 ? Math.min(1, count / maxCount) : 0;

          return (
            <a
              key={iso}
              href={`/appointments?date=${iso}`}
              className={`relative flex flex-col items-center justify-center rounded-lg h-9 text-xs transition-all group ${
                isToday(day)
                  ? "bg-brand-500 text-white font-bold shadow-md shadow-brand-500/30"
                  : count > 0
                  ? "hover:bg-brand-500/20 text-slate-200"
                  : "hover:bg-white/[0.05] text-slate-500"
              }`}
              style={
                !isToday(day) && count > 0
                  ? { backgroundColor: `rgba(99,102,241,${0.08 + intensity * 0.2})` }
                  : undefined
              }
              title={count > 0 ? `${count} записей` : undefined}
            >
              <span>{day}</span>
              {count > 0 && (
                <span
                  className={`text-[8px] font-medium leading-none mt-0.5 ${
                    isToday(day) ? "text-white/80" : "text-brand-400"
                  }`}
                >
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-brand-500" />
          <span>Сегодня</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-brand-500/20" />
          <span>Записи</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────

export default function DashboardClient() {
  const [period, setPeriod] = useState(30);

  const { data: stats, isLoading } = api.metrics.getDashboardStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: chart } = api.metrics.getChartData.useQuery({ days: period });
  const { data: chart90 } = api.metrics.getChartData.useQuery({ days: 90 });
  const { data: referralStats, isLoading: referralLoading } = api.metrics.getWebSignupReferralStats.useQuery(
    { days: period },
    { refetchInterval: 60_000 },
  );

  const s = stats;

  return (
    <Shell>
      <div className="space-y-5">
        <header>
          <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-xs text-slate-400 mt-1">Метрики платформы в реальном времени</p>
        </header>

        {/* Stat cards */}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              title="Пользователи"
              value={s?.totalUsers ?? 0}
              icon={Users}
              {...STAT_COLORS.violet}
            />
            <StatCard
              title="Салоны"
              value={s?.totalTenants ?? 0}
              sub={`${s?.trialingCount ?? 0} на триале`}
              icon={Building2}
              {...STAT_COLORS.cyan}
            />
            <StatCard
              title="Подписки"
              value={s?.activeSubscriptions ?? 0}
              icon={CreditCard}
              {...STAT_COLORS.emerald}
            />
            <StatCard
              title="MRR"
              value={formatPlnWhole(s?.mrr ?? 0)}
              sub="расчётный, PLN"
              icon={TrendingUp}
              {...STAT_COLORS.amber}
            />
            <StatCard
              title="Всего записей"
              value={s?.totalAppointments ?? 0}
              icon={CalendarDays}
              {...STAT_COLORS.pink}
            />
            <StatCard
              title="Сегодня"
              value={s?.todayAppointments ?? 0}
              sub="записей"
              icon={Clock}
              {...STAT_COLORS.blue}
            />
          </div>
        )}

        {/* Chart + Calendar side by side on wide screens */}
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
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

          {/* Calendar */}
          <MiniCalendar data={chart90 ?? []} />
        </div>

        {referralLoading ? (
          <div className="glass-card rounded-2xl p-8 animate-pulse text-center text-xs text-slate-500">
            Загрузка статистики регистраций…
          </div>
        ) : (
          <ReferralSignupCharts
            bySource={referralStats?.bySourceInPeriod ?? []}
            daily={referralStats?.dailySignupBySource ?? []}
            totalLabel={
              referralStats != null
                ? `Всего ${referralStats.totalSignupsInPeriod} за ${period} дн.`
                : undefined
            }
          />
        )}

        {/* Recent activity */}
        <div className="glass-card rounded-2xl p-4">
          <h2 className="text-sm font-bold text-white mb-3">Последняя активность</h2>
          <div className="space-y-3">
            {(s?.recentActivity ?? []).map((a, i) => (
              <div
                key={a.id + i}
                className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0 rounded-lg transition-colors hover:bg-white/[0.03]"
              >
                <div className="h-8 w-8 shrink-0 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-400 text-xs font-bold">
                  {a.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{a.name}</p>
                  <p className="text-[10px] text-slate-500 truncate">{a.action}</p>
                </div>
                <span className="text-[10px] text-slate-600 shrink-0 tabular-nums">{a.time}</span>
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
