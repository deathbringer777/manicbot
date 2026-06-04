"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Shell } from "~/components/layout/Shell";
import { PageHeader } from "~/components/ui/PageHeader";
import { KpiCard, KpiCardSkeleton } from "~/components/ui/KpiCard";
import { Card, CardHeader } from "~/components/ui/Card";
import { Skeleton } from "~/components/ui/Skeleton";
import { OverviewChart } from "~/components/dashboard/OverviewChart";
import { ReferralSignupCharts } from "~/components/dashboard/ReferralSignupCharts";
import { ErrorStatsWidget } from "~/components/dashboard/ErrorStatsWidget";
import {
  Users,
  Building2,
  TrendingUp,
  CalendarDays,
  CreditCard,
  Clock,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Zap,
  Activity,
} from "lucide-react";
import { formatPlnWhole } from "~/lib/money";
import { useLang } from "~/components/LangContext";
import { t, localeFor, formatRelativeTime, type Lang, type TranslationKey } from "~/lib/i18n";

type ActivityEntry = {
  id: number | string;
  name: string;
  kind: "tenant_created" | "booking";
  status: "confirmed" | "pending" | "cancelled" | "rejected" | "no_show" | "done" | null;
  icon: "salon" | "appointment";
  ts: number;
};

function activityActionLabel(a: ActivityEntry, lang: Lang): string {
  if (a.kind === "tenant_created") return t("activity.tenantCreated", lang);
  const map: Record<string, TranslationKey> = {
    confirmed: "activity.bookingConfirmed",
    pending:   "activity.bookingPending",
    cancelled: "activity.bookingCancelled",
    rejected:  "activity.bookingRejected",
    no_show:   "activity.bookingNoShow",
    done:      "activity.bookingDone",
  };
  const key = a.status ? map[a.status] ?? "activity.bookingPending" : "activity.bookingPending";
  return t(key, lang);
}

// ─── Period switcher ──────────────────────────────────────────────

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// ─── MiniCalendar ─────────────────────────────────────────────────

const WEEKDAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function MiniCalendar({ data, lang }: { data: { date: string; appointments: number }[]; lang: Lang }) {
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

  const monthLabel = viewDate.toLocaleString(localeFor(lang), { month: "long", year: "numeric" });
  const maxCount = Math.max(1, ...Object.values(dayMap));

  return (
    <Card padding="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-accent-500" />
          <h2 className="text-[13px] font-semibold text-[#1a1a2e] dark:text-white capitalize">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setViewDate(new Date(year, month - 1))}
            className="p-1.5 rounded-lg text-[#9ca3af] dark:text-slate-400 hover:text-[#374151] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewDate(new Date())}
            className="px-2 py-0.5 rounded-lg text-[10px] font-medium text-[#9ca3af] dark:text-slate-400 hover:text-[#374151] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            {t("gmHome.todayBtn", lang)}
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month + 1))}
            className="p-1.5 rounded-lg text-[#9ca3af] dark:text-slate-400 hover:text-[#374151] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-[#9ca3af] py-1">{d}</div>
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
                  ? "bg-[#1a1a2e] dark:bg-accent-500 text-white font-bold shadow-sm"
                  : count > 0
                  ? "hover:bg-accent-500/20 text-[#374151] dark:text-slate-200"
                  : "hover:bg-[#f3f4f6] dark:hover:bg-white/[0.05] text-[#6b7280] dark:text-slate-500"
              }`}
              style={
                !isToday(day) && count > 0
                  ? { backgroundColor: `rgba(11,155,107,${0.07 + intensity * 0.18})` }
                  : undefined
              }
              title={count > 0 ? `${count} bookings` : undefined}
            >
              <span>{day}</span>
              {count > 0 && (
                <span className={`text-[8px] font-medium leading-none mt-0.5 ${isToday(day) ? "text-white/70" : "text-accent-600 dark:text-accent-400"}`}>
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10px] text-[#9ca3af]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-[#1a1a2e] dark:bg-accent-500" />
          <span>{t("gmHome.todayLegend", lang)}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-accent-500/25" />
          <span>{t("gmHome.bookingsLegend", lang)}</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────

export default function DashboardClient() {
  const { lang } = useLang();
  const [period, setPeriod] = useState(30);

  const QUICK_ACTIONS = [
    { href: "/users", label: t("gmHome.viewUsers", lang), icon: Users },
    { href: "/tenants", label: t("gmHome.manageSalons", lang), icon: Building2 },
    { href: "/appointments", label: t("gmHome.appointmentsLink", lang), icon: CalendarDays },
    { href: "/billing", label: t("gmHome.billingLink", lang), icon: CreditCard },
  ];

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
          title={t("gmHome.title", lang)}
          subtitle={t("gmHome.subtitle", lang)}
        />

        {/* ── KPI Row ── */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label={t("gmHome.totalUsers", lang)}
              value={s?.totalUsers ?? 0}
              icon={Users}
              iconBg="bg-violet-50 dark:bg-violet-500/15"
              iconColor="text-violet-600 dark:text-violet-400"
              href="/users"
            />
            <KpiCard
              label={t("gmHome.salons", lang)}
              value={s?.totalTenants ?? 0}
              subtext={`${s?.trialingCount ?? 0} ${t("gmHome.trialing", lang)}`}
              icon={Building2}
              iconBg="bg-blue-50 dark:bg-blue-500/15"
              iconColor="text-blue-600 dark:text-blue-400"
              href="/tenants"
            />
            <KpiCard
              label={t("gmHome.mrr", lang)}
              value={formatPlnWhole(s?.mrr ?? 0)}
              subtext={t("gmHome.estimatedPLN", lang)}
              icon={TrendingUp}
              iconBg="bg-accent-50 dark:bg-accent-500/15"
              iconColor="text-accent-600 dark:text-accent-400"
              href="/billing"
            />
            <KpiCard
              label={t("gmHome.todayBookings", lang)}
              value={s?.todayAppointments ?? 0}
              subtext={`${(s?.totalAppointments ?? 0).toLocaleString(localeFor(lang))} ${t("gmHome.totalSuffix", lang)}`}
              icon={CalendarDays}
              iconBg="bg-amber-50 dark:bg-amber-500/15"
              iconColor="text-amber-600 dark:text-amber-400"
              href="/appointments"
            />
          </div>
        )}

        {/* ── Second KPI row: subscriptions + billing ── */}
        {!isLoading && (
          <div className="grid grid-cols-2 gap-4">
            <KpiCard
              label={t("gmHome.activeSubs", lang)}
              value={s?.activeSubscriptions ?? 0}
              icon={CreditCard}
              iconBg="bg-emerald-50 dark:bg-emerald-500/15"
              iconColor="text-emerald-600 dark:text-emerald-400"
              href="/billing"
            />
            <KpiCard
              label={t("gmHome.totalBookings", lang)}
              value={s?.totalAppointments ?? 0}
              subtext={t("gmHome.allTime", lang)}
              icon={Clock}
              iconBg="bg-pink-50 dark:bg-pink-500/15"
              iconColor="text-pink-600 dark:text-pink-400"
              href="/appointments"
            />
          </div>
        )}
        {isLoading && (
          <div className="grid grid-cols-2 gap-4">
            <KpiCardSkeleton /><KpiCardSkeleton />
          </div>
        )}

        {/* Error monitoring widget */}
        <ErrorStatsWidget />

        {/* ── Chart + Calendar ── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card padding="p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-semibold text-[#1a1a2e] dark:text-white">{t("gmHome.bookingsOverTime", lang)}</h2>
              <div className="flex gap-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => setPeriod(p.days)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
                      period === p.days
                        ? "bg-accent-500/15 text-accent-700 dark:text-accent-400"
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

          <MiniCalendar data={chart90 ?? []} lang={lang} />
        </div>

        {/* ── Referral charts ── */}
        {referralLoading ? (
          <Card padding="p-8">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-48" />
            </div>
          </Card>
        ) : (
          <ReferralSignupCharts
            bySource={referralStats?.bySourceInPeriod ?? []}
            daily={referralStats?.dailySignupBySource ?? []}
            totalLabel={
              referralStats != null
                ? `${referralStats.totalSignupsInPeriod} ${t("gmHome.signupsInPeriod", lang)} ${period}${t("gmHome.daysShort", lang)}`
                : undefined
            }
          />
        )}

        {/* ── Bottom row: Activity + Quick actions ── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          {/* Recent activity */}
          <Card padding="p-5">
            <CardHeader
              title={t("gmHome.recentActivity", lang)}
              action={
                <Link href="/events" className="flex items-center gap-1 text-[12px] font-medium text-accent-600 dark:text-accent-400 hover:opacity-80">
                  {t("gmHome.viewAll", lang)} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <div className="space-y-1">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-2.5 w-48" />
                      </div>
                    </div>
                  ))
                : (s?.recentActivity ?? []).length === 0
                ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <Activity className="h-8 w-8 text-[#d1d5db] dark:text-slate-600 mb-2" />
                    <p className="text-[13px] text-[#6b7280] dark:text-slate-500">{t("gmHome.noRecentActivity", lang)}</p>
                  </div>
                )
                : (s?.recentActivity ?? []).map((a, i) => (
                    <div
                      key={String(a.id) + i}
                      className="flex items-center gap-3 py-2.5 border-b border-[#f3f4f6] dark:border-white/[0.04] last:border-0 rounded-lg px-1 hover:bg-[#fafaf7] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="h-8 w-8 shrink-0 rounded-full bg-accent-500/10 flex items-center justify-center text-accent-600 dark:text-accent-400 text-[11px] font-bold">
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#1a1a2e] dark:text-white truncate">{a.name}</p>
                        <p className="text-[11px] text-[#6b7280] dark:text-slate-500 truncate">{activityActionLabel(a as ActivityEntry, lang)}</p>
                      </div>
                      <span className="text-[11px] text-[#9ca3af] dark:text-slate-600 shrink-0 tabular-nums">{formatRelativeTime(a.ts, lang)}</span>
                    </div>
                  ))
              }
            </div>
          </Card>

          {/* Quick actions */}
          <Card padding="p-5">
            <CardHeader title={t("gmHome.quickActions", lang)} />
            <div className="space-y-1.5">
              {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-[#374151] dark:text-slate-300 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.04] hover:text-[#1a1a2e] dark:hover:text-white transition-colors group"
                >
                  <Icon className="h-4 w-4 text-[#9ca3af] dark:text-slate-500 group-hover:text-accent-600 dark:group-hover:text-accent-400 transition-colors shrink-0" />
                  <span className="flex-1">{label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-[#d1d5db] dark:text-slate-600 group-hover:text-[#6b7280] dark:group-hover:text-slate-400 transition-colors" />
                </Link>
              ))}
              <div className="pt-2 mt-2 border-t border-[#f3f4f6] dark:border-white/[0.04]">
                <Link
                  href="/plugins"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium text-accent-700 dark:text-accent-400 hover:bg-accent-500/8 dark:hover:bg-accent-500/15 transition-colors group"
                >
                  <Zap className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{t("gmHome.pluginMarketplace", lang)}</span>
                  <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
