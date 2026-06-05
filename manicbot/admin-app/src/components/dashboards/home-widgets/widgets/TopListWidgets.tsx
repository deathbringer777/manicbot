"use client";

/**
 * top_services / top_masters widgets — ranked lists of the busiest services and
 * masters over the selected period, read from `salonMetrics.getTopServices` /
 * `getTopMasters`. Both share one presentational shell (`RankedList`) so the row
 * styling stays identical; only the data source and the leading glyph differ
 * (service emoji vs. master initial).
 */

import { api } from "~/trpc/react";
import { Card } from "~/components/ui/Card";
import { t, type Lang } from "~/lib/i18n";
import type { WidgetRenderProps } from "../registry";
import type { MetricsPeriod } from "~/server/api/routers/salonMetrics";

function asPeriod(value: string | undefined): MetricsPeriod {
  return value === "7d" || value === "90d" ? value : "30d";
}

function asLimit(value: string | undefined): number {
  const n = Number(value);
  return n === 10 ? 10 : 5;
}

interface RankedRow {
  key: string;
  /** Leading glyph: an emoji (services) or an initial (masters). */
  glyph: string;
  name: string;
  bookings: number;
}

function RankedList({
  rows,
  loading,
  error,
  lang,
}: {
  rows: RankedRow[];
  loading: boolean;
  error: boolean;
  lang: Lang;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <div className="h-8 w-8 shrink-0 rounded-lg skeleton-shimmer" />
            <div className="h-3 flex-1 rounded skeleton-shimmer" />
            <div className="h-3 w-10 rounded skeleton-shimmer" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return <p className="py-8 text-center text-sm text-red-500 dark:text-red-400">{t("home.error", lang)}</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-[13px] text-[#6b7280] dark:text-slate-500">
        {t("widget.top.empty", lang)}
      </p>
    );
  }
  return (
    <ol className="space-y-0.5">
      {rows.map((r, i) => (
        <li
          key={r.key}
          className="flex items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-[#fafaf7] dark:hover:bg-white/[0.02]"
        >
          <span className="w-4 shrink-0 text-center text-[11px] font-bold tabular-nums text-[#9ca3af] dark:text-slate-600">
            {i + 1}
          </span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-[13px] font-bold text-accent-600 dark:text-accent-400">
            {r.glyph}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1a1a2e] dark:text-white">
            {r.name}
          </span>
          <span className="shrink-0 text-[12px] tabular-nums text-[#6b7280] dark:text-slate-400">
            {r.bookings} {t("widget.top.bookings", lang)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TopServicesWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  const q = api.salonMetrics.getTopServices.useQuery(
    { tenantId, period: asPeriod(opts.period), limit: asLimit(opts.limit) },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const rows: RankedRow[] = (q.data ?? []).map((s) => ({
    key: s.svcId,
    glyph: s.emoji || "•",
    name: s.name,
    bookings: s.bookings,
  }));
  return (
    <Card padding="p-4" className="h-full overflow-y-auto">
      <RankedList rows={rows} loading={q.isLoading} error={q.isError} lang={lang} />
    </Card>
  );
}

export function TopMastersWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  const q = api.salonMetrics.getTopMasters.useQuery(
    { tenantId, period: asPeriod(opts.period), limit: asLimit(opts.limit) },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const rows: RankedRow[] = (q.data ?? []).map((m) => ({
    key: m.masterId,
    glyph: (m.name.trim().charAt(0) || "?").toUpperCase(),
    name: m.name,
    bookings: m.bookings,
  }));
  return (
    <Card padding="p-4" className="h-full overflow-y-auto">
      <RankedList rows={rows} loading={q.isLoading} error={q.isError} lang={lang} />
    </Card>
  );
}
