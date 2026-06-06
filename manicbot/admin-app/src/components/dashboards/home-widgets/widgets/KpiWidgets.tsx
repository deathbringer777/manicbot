"use client";

/**
 * KPI widgets — the five single-metric tiles on the salon home board.
 *
 * All five read the SAME `salonMetrics.getKpiSummary` query; React Query dedupes
 * the network call, so rendering all five costs one request per `period`. Each
 * tile renders ONLY its value — the surrounding `WidgetFrame` already supplies
 * the title + icon + card chrome, so the body stays a clean number (no nested
 * card, no duplicated label/icon).
 *
 * `kpi_new_clients` + `kpi_no_show_rate` are period-scoped (their registry
 * `period` dropdown); the other three use the 30-day default window.
 */

import { api } from "~/trpc/react";
import { formatPlnWhole } from "~/lib/money";
import { t, localeFor, type Lang } from "~/lib/i18n";
import type { WidgetRenderProps } from "../registry";
import type { KpiSummary, MetricsPeriod } from "~/server/api/routers/salonMetrics";

/** Default rolling window for the period-agnostic KPI tiles. */
const DEFAULT_PERIOD: MetricsPeriod = "30d";

function asPeriod(value: string | undefined): MetricsPeriod {
  return value === "7d" || value === "90d" ? value : "30d";
}

/** Big-number body shared by every KPI tile (title/icon live in WidgetFrame). */
function KpiValue({ value, subtext }: { value: string | number; subtext?: string }) {
  return (
    <div className="flex h-full flex-col justify-center px-4 py-2">
      <div className="truncate text-[28px] font-bold leading-none text-[#1a1a2e] dark:text-white">
        {value}
      </div>
      {subtext && (
        <div className="mt-1 truncate text-xs text-[#6b7280] dark:text-slate-400">{subtext}</div>
      )}
    </div>
  );
}

/**
 * Runs the deduped summary query; shows a slim skeleton while loading and an
 * error-toned value on failure, otherwise hands the summary to `render`.
 */
function KpiShell({
  tenantId,
  lang,
  period,
  render,
}: {
  tenantId: string;
  lang: Lang;
  period: MetricsPeriod;
  render: (summary: KpiSummary) => { value: string | number; subtext?: string };
}) {
  const q = api.salonMetrics.getKpiSummary.useQuery(
    { tenantId, period },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (q.isLoading) {
    return (
      <div className="flex h-full items-center px-4">
        <div className="h-7 w-20 animate-pulse rounded-md bg-[#f3f4f6] dark:bg-white/[0.06]" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="flex h-full items-center px-4 text-sm text-red-500 dark:text-red-400">
        {t("home.error", lang)}
      </div>
    );
  }

  const { value, subtext } = render(q.data);
  return <KpiValue value={value} subtext={subtext} />;
}

export function KpiTotalClientsWidget({ tenantId, lang }: WidgetRenderProps) {
  return (
    <KpiShell tenantId={tenantId} lang={lang} period={DEFAULT_PERIOD} render={(s) => ({ value: s.totalClients })} />
  );
}

export function KpiWeekAppointmentsWidget({ tenantId, lang }: WidgetRenderProps) {
  return (
    <KpiShell tenantId={tenantId} lang={lang} period={DEFAULT_PERIOD} render={(s) => ({ value: s.weekAppointments })} />
  );
}

export function KpiMonthRevenueWidget({ tenantId, lang }: WidgetRenderProps) {
  return (
    <KpiShell
      tenantId={tenantId}
      lang={lang}
      period={DEFAULT_PERIOD}
      render={(s) => ({ value: formatPlnWhole(s.monthRevenue) })}
    />
  );
}

export function KpiNewClientsWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  return (
    <KpiShell
      tenantId={tenantId}
      lang={lang}
      period={asPeriod(opts.period)}
      render={(s) => ({ value: s.newClients })}
    />
  );
}

export function KpiNoShowRateWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  return (
    <KpiShell
      tenantId={tenantId}
      lang={lang}
      period={asPeriod(opts.period)}
      render={(s) => ({
        // noShowRate is a 0..1 fraction; render as a whole-ish percentage.
        value: `${(s.noShowRate * 100).toLocaleString(localeFor(lang), { maximumFractionDigits: 1 })}%`,
      })}
    />
  );
}
