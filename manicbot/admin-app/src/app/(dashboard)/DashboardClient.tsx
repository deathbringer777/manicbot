"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { Card, CardHeader } from "~/components/ui/Card";
import { KpiCard, KpiCardSkeleton } from "~/components/ui/KpiCard";
import { PageHeader } from "~/components/ui/PageHeader";
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
  ArrowUpRight,
  Zap,
  UserPlus,
  BarChart3,
} from "lucide-react";
import { formatPlnWhole } from "~/lib/money";

// ─── Period switcher ──────────────────────────────────────────────

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
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
    <Card padding="p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-accent-500" />
          <h2 className="text-sm font-semibold text-[#1a1a2e] dark:text-white capitalize">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewDate(new Date(year, month - 1))}
            className="p-1 rounded-lg text-[#9ca3af] hover:text-[#1a1a2e] dark:hover:text-white hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewDate(new Date())}
            className="px-2 py-0.5 rounded-lg text-[10px] font-medium text-[#6b7280] hover:text-[#1a1a2e] dark:hover:text-white hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            today
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month + 1))}
            className="p-1 rounded-lg text-[#9ca3af] hover:text-[#1a1a2e] dark:hover:text-white hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-[#9ca3af] py-1">
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
              className={`relative flex flex-col items-center justify-center rounded-lg h-9 text-xs transition-all ${
                isToday(day)
                  ? "bg-accent-500 text-white font-bold shadow-sm"
                  : count > 0
                  ? "hover:bg-accent-500/15 text-[#374151] dark:text-slate-200"
                  : "hover:bg-[#f3f4f6] dark:hover:bg-white/[0.05] text-[#6b7280]"
              }`}
              style={
                !isToday(day) && count > 0
                  ? { backgroundColor: `rgba(11,155,107,${0.07 + intensity * 0.18})` }
                  : undefined
              }
              title={count > 0 ? `${count} appointments` : undefined}
            >
              <span>{day}</span>
              {count > 0 && (
                <span className={`text-[8px] font-medium leading-none mt-0.5 ${isToday(day) ? "text-white/80" : "text-accent-600"}`}>
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10px] text-[#9ca3af]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-accent-500" />
          <span>Today</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-accent-500/20" />
          <span>Bookings</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Quick Actions ─────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: "Add user", icon: UserPlus, href: "/users", color: "text-violet-600 bg-violet-50 dark:bg-violet-500/10 dark:text-violet-400" },
  { label: "Tenants", icon: Building2, href: "/tenants", color: "text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10 dark:text-cyan-400" },
  { label: "Bookings", icon: CalendarDays, href: "/appointments", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400" },
  { label: "Billing", icon: CreditCard, href: "/billing", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400" },
  { label: "Marketing", icon: Zap, href: "/marketing", color: "text-pink-600 bg-pink-50 dark:bg-pink-500/10 dark:text-pink-400" },
  { label: "Analytics", icon: BarChart3, href: "/system", color: "text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400" },
];

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
          subtitle="Platform metrics in real time"
        />

        {/* Primary KPI row — 4 cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label="Total Clients"
                value={s?.totalUsers ?? 0}
                icon={Users}
                iconBg="bg-violet-50 dark:bg-violet-500/10"
                iconColor="text-violet-600 dark:text-violet-400"
                href="/users"
              />
              <KpiCard
                label="Active Salons"
                value={s?.totalTenants ?? 0}
                subtext={`${s?.trialingCount ?? 0} trialing`}
                icon={Building2}
                iconBg="bg-cyan-50 dark:bg-cyan-500/10"
                iconColor="text-cyan-600 dark:text-cyan-400"
                href="/tenants"
              />
              <KpiCard
                label="Revenue MRR"
                value={formatPlnWhole(s?.mrr ?? 0)}
                subtext="estimated, PLN"
                icon={TrendingUp}
                iconBg="bg-emerald-50 dark:bg-emerald-500/10"
                iconColor="text-emerald-600 dark:text-emerald-400"
                href="/billing"
              />
              <KpiCard
                label="Today's Bookings"
                value={s?.todayAppointments ?? 0}
                subtext={`${s?.totalAppointments ?? 0} total`}
                icon={CalendarDays}
                iconBg="bg-amber-50 dark:bg-amber-500/10"
                iconColor="text-amber-600 dark:text-amber-400"
                href="/appointments"
              />
            </>
          )}
        </div>

        {/* Secondary row */}
        <div className="grid grid-cols-2 gap-4">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : (
            <>
              <KpiCard
                label="Active Subscriptions"
                value={s?.activeSubscriptions ?? 0}
                icon={CreditCard}
                iconBg="bg-pink-50 dark:bg-pink-500/10"
                iconColor="text-pink-600 dark:text-pink-400"
                href="/billing"
              />
              <KpiCard
                label="All-time Bookings"
                value={s?.totalAppointments ?? 0}
                icon={Clock}
                iconBg="bg-blue-50 dark:bg-blue-500/10"
                iconColor="text-blue-600 dark:text-blue-400"
                href="/appointments"
              />
            </>
          )}
        </div>

        {/* Quick Actions */}
        <Card padding="p-5">
          <CardHeader title="Quick Actions" />
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href + action.label}
                href={action.href}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-[#e5e7eb] dark:border-white/[0.06] hover:border-accent-500/30 hover:bg-accent-500/[0.03] transition-all duration-150 group"
              >
                <div className={`h-9 w-9 flex items-center justify-center rounded-xl ${action.color} transition-transform group-hover:scale-110 duration-150`}>
                  <action.icon className="h-4 w-4" />
                </div>
                <span className="text-[11px] font-medium text-[#6b7280] dark:text-slate-400 text-center leading-tight group-hover:text-[#1a1a2e] dark:group-hover:text-white transition-colors">
                  {action.label}
                </span>
              </Link>
            ))}
          </div>
        </Card>

        {/* Chart + Calendar */}
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card padding="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#1a1a2e] dark:text-white">Bookings over time</h2>
              <div className="flex gap-1 p-0.5 rounded-lg bg-[#f3f4f6] dark:bg-white/[0.04]">
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => setPeriod(p.days)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      period === p.days
                        ? "bg-white dark:bg-white/10 text-[#1a1a2e] dark:text-white shadow-sm"
                        : "text-[#6b7280] hover:text-[#1a1a2e] dark:hover:text-slate-200"
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

        {/* Referral signup charts */}
        {referralLoading ? (
          <Card padding="p-6">
            <div className="space-y-3">
              <div className="h-4 w-48 rounded skeleton-shimmer" />
              <div className="h-32 w-full rounded-lg skeleton-shimmer" />
            </div>
          </Card>
        ) : (
          <ReferralSignupCharts
            bySource={referralStats?.bySourceInPeriod ?? []}
            daily={referralStats?.dailySignupBySource ?? []}
            totalLabel={
              referralStats != null
                ? `Total ${referralStats.totalSignupsInPeriod} signups in ${period}d`
                : undefined
            }
          />
        )}

        {/* Recent activity */}
        <Card padding="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-semibold text-[#1a1a2e] dark:text-white">Recent Activity</h2>
            <Link
              href="/events"
              className="flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400 hover:text-accent-700 font-medium transition-colors"
            >
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="space-y-0">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3 border-b border-[#f3f4f6] dark:border-white/[0.04] last:border-0">
                  <div className="h-8 w-8 shrink-0 rounded-full skeleton-shimmer" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded skeleton-shimmer" />
                    <div className="h-2.5 w-48 rounded skeleton-shimmer" />
                  </div>
                  <div className="h-2.5 w-10 rounded skeleton-shimmer shrink-0" />
                </div>
              ))
            ) : (s?.recentActivity ?? []).length === 0 ? (
              <p className="text-sm text-[#9ca3af] py-8 text-center">No recent activity</p>
            ) : (
              (s?.recentActivity ?? []).map((a, i) => (
                <div
                  key={a.id + i}
                  className="flex items-center gap-3 py-2.5 border-b border-[#f3f4f6] dark:border-white/[0.04] last:border-0 px-1 rounded-lg hover:bg-[#f9fafb] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <div className="h-8 w-8 shrink-0 rounded-full bg-accent-500/10 flex items-center justify-center text-accent-600 dark:text-accent-400 text-xs font-bold">
                    {a.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#1a1a2e] dark:text-white truncate">{a.name}</p>
                    <p className="text-[11px] text-[#9ca3af] truncate">{a.action}</p>
                  </div>
                  <span className="text-[11px] text-[#9ca3af] shrink-0 tabular-nums">{a.time}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
