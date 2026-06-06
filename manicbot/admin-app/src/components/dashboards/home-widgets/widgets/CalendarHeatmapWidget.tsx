"use client";

/**
 * calendar_heatmap widget — wraps the shared `MiniCalendar` heatmap, fed by
 * `salonMetrics.getDailyCounts`. The registry `view` option (month/week) maps
 * to how many trailing days we request; the grid itself always renders a full
 * month, so "week" simply narrows the tinted range to the last 7 days.
 */

import { api } from "~/trpc/react";
import { MiniCalendar } from "../MiniCalendar";
import { Card } from "~/components/ui/Card";
import { t } from "~/lib/i18n";
import type { WidgetRenderProps } from "../registry";

/** Trailing-day window per `view` option (default = full month). */
const MONTH_DAYS = 31;
const WEEK_DAYS = 7;

export function CalendarHeatmapWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  const days = opts.view === "week" ? WEEK_DAYS : MONTH_DAYS;
  const q = api.salonMetrics.getDailyCounts.useQuery(
    { tenantId, days },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (q.isError) {
    return (
      <Card padding="p-4">
        <p className="text-center text-sm text-red-500 dark:text-red-400">{t("home.error", lang)}</p>
      </Card>
    );
  }

  // MiniCalendar renders fine with an empty array (no tinting) — no separate
  // skeleton needed; the grid shows immediately and fills in on load.
  return <MiniCalendar data={q.data ?? []} lang={lang} />;
}
