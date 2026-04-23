"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { OverviewChart } from "~/components/dashboard/OverviewChart";
import { ReferralSignupCharts } from "~/components/dashboard/ReferralSignupCharts";
import { KpiCard, KpiCardSkeleton } from "~/components/ui/KpiCard";
import { PageHeader } from "~/components/ui/PageHeader";
import { Card } from "~/components/ui/Card";
import {
  Users,
  Building2,
  TrendingUp,
  CalendarDays,
  CreditCard,
  Clock,
  ChevronLeft,
  ChevronRight,
  Activity,
} from "lucide-react";
import { formatPlnWhole } from "~/lib/money";

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
  const firstDow = new Date(year, month, 1).getDay();
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
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-brand-500" />
          <h2 className="text-sm font-semibold text-[#1a1a2e] dark:text-white capitalize">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewDate(new Date(year, month - 1))}
            className="p-1.5 rounded-lg text-[#6b7280] dark:text-slate-400 hover:text-[#1a1a2e] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewDate(new Date())}
            className="px-2 py-0.5 rounded-lg text-[10px] font-medium text-[#6b7280] dark:text-slate-400 hover:text-[#1a1a2e] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            сейчас
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month + 1))}
            className="p-1.5 rounded-lg text-[#6b7280] dark:text-slate-400 hover:text-[#1a1a2e] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-[#9ca3af] dark:text-slate-500 py-1">
            {d}
          </div>
        ))}
      </div>

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
                  ? "bg-brand-500 text-white font-bold shadow-sm shadow-brand-500/30"
                  : count > 0
                  ? "hover:bg-brand-500/20 text-[#374151] dark:text-slate-200"
                  : "hover:bg-[#f3f4f6] dark:hover:bg-white/[0.05] text-[#6b7280] dark:text-slate-500"
              }`}
              style={
                !isToday(day) && count > 0
                  ? { backgroundColor: `rgba(11,155,107,${0.07 + intensity * 0.18})` }
                  : undefined
              }
              title={count > 0 ? `${count} записей` : undefined}
            >
              <span>{day}</span>
              {count > 0 && (
                <span className={`text-[8px] font-medium leading-none mt-0.5 ${isToday(day) ? "text-white/80" : "text-brand-500"}`}>
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 text-[10px] text-[#9ca3af] dark:text-slate-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-brand-500" />
          <span>Сегодня</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-brand-500/20" />
          <span>Записи</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Activity feed ────────────────────────────────────────────────

function ActivityFeedCard({
  items,
  loading,
}: {
  items: { id: string; name: string; action: string; time: string }[];
  loading: boolean;
}) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-brand-500" />
        <h2 className="text-sm font-semibold text-[#1a1a2e] dark:text-white">Последняя активность</h2>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3 w-32" />
                <div className="skeleton h-2.5 w-20" />
              </div>
              <div className="skeleton h-2.5 w-12" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-[#6b7280] dark:text-slate-400">Нет активности</p>
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((a, i) => (
            <div
              key={a.id + i}
              className="flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-lg border-b border-[#e5e7eb]/60 dark:border-white/[0.04] last:border-0 hover:bg-[#f9fafb] dark:hover:bg-white/[0.02] transition-colors"
            >
              <div className="h-8 w-8 shrink-0 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-600 dark:text-brand-400 text-xs font-bold">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#1a1a2e] dark:text-white truncate">{a.name}</p>
                <p className="text-[11px] text-[#6b7280] dark:text-slate-500 truncate">{a.action}</p>
              </div>
              <span className="text-[11px] text-[#9ca3af] dark:text-slate-600 shrink-0 tabular-nums">{a.time}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
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
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Dashboard"
          subtitle="Метрики платформы в реальном времени"
        />

        {/* KPI cards grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Пользователи"
              metric={s?.totalUsers ?? 0}
              icon={Users}
              accent="violet"
              href="/users"
            />
            <KpiCard
              label="Салоны"
              metric={s?.totalTenants ?? 0}
              sublabel={`${s?.trialingCount ?? 0} на триале`}
              icon={Building2}
              accent="cyan"
              href="/tenants"
            />
            <KpiCard
              label="Подписки"
              metric={s?.activeSubscriptions ?? 0}
              icon={CreditCard}
              accent="green"
              href="/billing"
            />
            <KpiCard
              label="MRR"
              metric={formatPlnWhole(s?.mrr ?? 0)}
              sublabel="расчётный, PLN"
              icon={TrendingUp}
              accent="amber"
              href="/billing"
            />
            <KpiCard
              label="Всего записей"
              metric={s?.totalAppointments ?? 0}
              icon={CalendarDays}
              accent="pink"
              href="/appointments"
            />
            <KpiCard
              label="Сегодня"
              metric={s?.todayAppointments ?? 0}
              sublabel="записей"
              icon={Clock}
              accent="blue"
              href="/appointments"
            />
          </div>
        )}

        {/* Chart + Calendar */}
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <Card padding="md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#1a1a2e] dark:text-white">Записи по дням</h2>
              <div className="flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => setPeriod(p.days)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      period === p.days
                        ? "bg-brand-500/10 text-brand-600 dark:text-brand-400"
                        : "text-[#6b7280] dark:text-slate-400 hover:bg-[#f3f4f6] dark:hover:bg-slate-800"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <OverviewChart data={chart ?? []} />
          </Card>

          <MiniCalendar data={chart90 ?? []} />
        </div>

        {/* Referral charts */}
        {referralLoading ? (
          <Card padding="md">
            <div className="skeleton h-4 w-40 mb-4" />
            <div className="skeleton h-32 w-full rounded-lg" />
          </Card>
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

        {/* Activity feed */}
        <ActivityFeedCard
          items={s?.recentActivity ?? []}
          loading={isLoading}
        />
      </div>
    </Shell>
  );
}
