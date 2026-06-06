"use client";

/**
 * activity_feed widget — recent tenant activity (bookings, etc.) from
 * `salonMetrics.getRecentActivity`. Row layout mirrors the god-mode dashboard's
 * activity list (avatar initial + name + action label + relative time). The
 * action label reuses the shared `status.*` i18n keys so booking states read
 * consistently across the app.
 */

import { Activity } from "lucide-react";
import { api } from "~/trpc/react";
import { Card } from "~/components/ui/Card";
import { t, formatRelativeTime, type Lang, type TranslationKey } from "~/lib/i18n";
import type { WidgetRenderProps } from "../registry";
import type { ActivityItem } from "~/server/api/routers/salonMetrics";

function asLimit(value: string | undefined): number {
  const n = Number(value);
  return n === 10 ? 10 : 5;
}

/** Status → shared `status.*` key. Unknown statuses fall back to "pending". */
const STATUS_KEYS: Record<string, TranslationKey> = {
  confirmed: "status.confirmed",
  pending: "status.pending",
  cancelled: "status.cancelled",
  rejected: "status.rejected",
  no_show: "status.no_show",
  done: "status.done",
};

function actionLabel(a: ActivityItem, lang: Lang): string {
  return t(STATUS_KEYS[a.status] ?? "status.pending", lang);
}

export function ActivityFeedWidget({ tenantId, lang, opts }: WidgetRenderProps) {
  const q = api.salonMetrics.getRecentActivity.useQuery(
    { tenantId, limit: asLimit(opts.limit) },
    { enabled: !!tenantId, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  return (
    <Card padding="p-4" className="h-full overflow-y-auto">
      {q.isLoading ? (
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <div className="h-8 w-8 shrink-0 rounded-full skeleton-shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded skeleton-shimmer" />
                <div className="h-2.5 w-24 rounded skeleton-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <p className="py-8 text-center text-sm text-red-500 dark:text-red-400">{t("home.error", lang)}</p>
      ) : (q.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Activity className="mb-2 h-8 w-8 text-[#d1d5db] dark:text-slate-600" />
          <p className="text-[13px] text-[#6b7280] dark:text-slate-500">{t("widget.activity.empty", lang)}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {(q.data ?? []).map((a, i) => (
            <div
              key={String(a.id) + i}
              className="flex items-center gap-3 rounded-lg border-b border-[#f3f4f6] px-1 py-2.5 transition-colors last:border-0 hover:bg-[#fafaf7] dark:border-white/[0.04] dark:hover:bg-white/[0.02]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-500/10 text-[11px] font-bold text-accent-600 dark:text-accent-400">
                {(a.name.trim().charAt(0) || "?").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[#1a1a2e] dark:text-white">{a.name}</p>
                <p className="truncate text-[11px] text-[#6b7280] dark:text-slate-500">{actionLabel(a, lang)}</p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-[#9ca3af] dark:text-slate-600">
                {formatRelativeTime(a.ts, lang)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
