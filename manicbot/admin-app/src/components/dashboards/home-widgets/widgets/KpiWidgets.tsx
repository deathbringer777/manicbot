"use client";

/**
 * KPI widgets — the five single-metric tiles on the salon home board.
 *
 * All five read the SAME `salonMetrics.getKpiSummary` query; React Query
 * dedupes the network call so rendering all of them costs one request per
 * `period`. Each widget is a thin wrapper that picks one field off the summary
 * and renders it through the shared `KpiCard` / `KpiCardSkeleton` atoms, so the
 * tiles match the god-mode dashboard's look exactly.
 *
 * `kpi_new_clients` and `kpi_no_show_rate` are period-scoped (their registry
 * `options` expose a `period` dropdown); the other three ignore `opts.period`
 * and always query the 30-day default window.
 */

import type { LucideIcon } from "lucide-react";
import { Users, CalendarDays, Wallet, UserPlus, UserX } from "lucide-react";
import { api } from "~/trpc/react";
import { KpiCard, KpiCardSkeleton } from "~/components/ui/KpiCard";
import { formatPlnWhole } from "~/lib/money";
import { t, localeFor, type Lang } from "~/lib/i18n";
import { WIDGET_REGISTRY, type HomeWidgetType, type WidgetRenderProps } from "../registry";
import type { KpiSummary, MetricsPeriod } from "~/server/api/routers/salonMetrics";

/** Default rolling window for the period-agnostic KPI tiles. */
const DEFAULT_PERIOD: MetricsPeriod = "30d";

function asPeriod(value: string | undefined): MetricsPeriod {
  return value === "7d" || value === "90d" ? value : "30d";
}

/**
 * Shared KPI tile shell: runs the deduped summary query, renders the skeleton
 * while loading and an error-toned card on failure, otherwise hands the loaded
 * summary to `render`.
 */
function KpiShell({
  type,
  tenantId,
  lang,
  period,
  icon,
  iconBg,
  iconColor,
  render,
}: {
  type: HomeWidgetType;
  tenantId: string;
  lang: Lang;
  period: MetricsPeriod;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  render: (summary: KpiSummary) => {
    value: string | number;
    subtext?: string;
  };
}) {
  const label = t(WIDGET_REGISTRY[type].titleKey, lang);
  const q = api.salonMetrics.getKpiSummary.useQuery(
    { tenantId, period },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (q.isLoading) return <KpiCardSkeleton />;
  if (q.isError || !q.data) {
    return (
      <KpiCard
        label={label}
        value={t("home.error", lang)}
        icon={icon}
        iconBg={iconBg}
        iconColor={iconColor}
      />
    );
  }

  const { value, subtext } = render(q.data);
  return (
    <KpiCard
      label={label}
      value={value}
      subtext={subtext}
      icon={icon}
      iconBg={iconBg}
      iconColor={iconColor}
    />
  );
}

export function KpiTotalClientsWidget({ tenantId, lang }: WidgetRenderProps) {
  return (
    <KpiShell
      type="kpi_total_clients"
      tenantId={tenantId}
      lang={lang}
      period={DEFAULT_PERIOD}
      icon={Users}
      iconBg="bg-violet-50 dark:bg-violet-500/15"
      iconColor="text-violet-600 dark:text-violet-400"
      render={(s) => ({ value: s.totalClients })}
    />
  );
}

export function KpiWeekAppointmentsWidget({ tenantId, lang }: WidgetRenderProps) {
  return (
    <KpiShell
      type="kpi_week_appointments"
      tenantId={tenantId}
      lang={lang}
      period={DEFAULT_PERIOD}
      icon={CalendarDays}
      iconBg="bg-amber-50 dark:bg-amber-500/15"
      iconColor="text-amber-600 dark:text-amber-400"
      render={(s) => ({ value: s.weekAppointments })}
    />
  );
}

export function KpiMonthRevenueWidget({ tenantId, lang }: WidgetRenderProps) {
  return (
    <KpiShell
      type="kpi_month_revenue"
      tenantId={tenantId}
      lang={lang}
      period={DEFAULT_PERIOD}
      icon={Wallet}
      iconBg="bg-accent-50 dark:bg-accent-500/15"
      iconColor="text-accent-600 dark:text-accent-400"
      render={(s) => ({ value: formatPlnWhole(s.monthRevenue) })}
    />
  );
}

export function KpiNewClientsWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  const period = asPeriod(opts.period);
  return (
    <KpiShell
      type="kpi_new_clients"
      tenantId={tenantId}
      lang={lang}
      period={period}
      icon={UserPlus}
      iconBg="bg-blue-50 dark:bg-blue-500/15"
      iconColor="text-blue-600 dark:text-blue-400"
      render={(s) => ({ value: s.newClients })}
    />
  );
}

export function KpiNoShowRateWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  const period = asPeriod(opts.period);
  return (
    <KpiShell
      type="kpi_no_show_rate"
      tenantId={tenantId}
      lang={lang}
      period={period}
      icon={UserX}
      iconBg="bg-red-50 dark:bg-red-500/15"
      iconColor="text-red-600 dark:text-red-400"
      render={(s) => ({
        // noShowRate is a 0..1 fraction; show as a whole-number percentage.
        value: `${(s.noShowRate * 100).toLocaleString(localeFor(lang), { maximumFractionDigits: 1 })}%`,
      })}
    />
  );
}
