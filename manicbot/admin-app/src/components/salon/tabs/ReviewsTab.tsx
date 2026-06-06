"use client";

import { Star } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { EmptyState } from "~/components/ui/EmptyState";
import { ReviewCard } from "~/components/salon/tabs/ReviewCard";

export function ReviewsTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const settings = api.reviews.getSettings.useQuery({ tenantId });
  const reviewStats = api.reviews.getStats.useQuery({ tenantId });
  const reviewList = api.reviews.getForSalon.useQuery({ tenantId });
  const breakdown = api.reviews.getMasterBreakdown.useQuery(
    { tenantId },
    { enabled: !!settings.data?.enabled },
  );
  const update = api.reviews.updateSettings.useMutation({
    onSuccess: () => {
      void utils.reviews.getSettings.invalidate();
      void utils.reviews.getMasterBreakdown.invalidate();
    },
  });

  const enabled = settings.data?.enabled ?? false;
  const timing = settings.data?.timing ?? "immediate";

  return (
    <div className="space-y-4">
      {/* ── Settings: enable + timing ───────────────────────────────────── */}
      <div className="glass-card rounded-2xl p-5 space-y-4" data-testid="reviews-settings">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Сбор оценок</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Когда включено, клиент после визита получает запрос оценки 1–5⭐ прямо в боте.
              Видно, какому мастеру какую оценку поставили. По умолчанию выключено.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Сбор оценок"
            data-testid="reviews-enabled-toggle"
            disabled={update.isPending || settings.isLoading}
            onClick={() => update.mutate({ tenantId, enabled: !enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[1.375rem]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {enabled && (
          <div data-testid="reviews-timing">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">Когда спрашивать клиента</p>
            <div className="flex flex-col sm:flex-row gap-2">
              {([
                { v: "immediate", label: "Сразу после визита", hint: "Как только мастер отметил «выполнено»" },
                { v: "delayed", label: "Позже, в течение суток", hint: "Фоновая отправка по расписанию" },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  data-testid={`reviews-timing-${opt.v}`}
                  aria-pressed={timing === opt.v}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ tenantId, timing: opt.v })}
                  className={`flex-1 text-left rounded-xl border px-3 py-2 transition-colors disabled:opacity-60 ${
                    timing === opt.v
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10"
                      : "border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20"
                  }`}
                >
                  <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{opt.label}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Salon-wide rating summary ───────────────────────────────────── */}
      {reviewStats.data && (
        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-4xl font-extrabold text-slate-900 dark:text-white">{reviewStats.data.avg || "—"}</p>
              <div className="flex gap-0.5 mt-1 justify-center">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} className={`w-4 h-4 ${s <= Math.round(reviewStats.data!.avg) ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">{reviewStats.data.count} reviews</p>
            </div>
            <div className="flex-1 space-y-1">
              {[5,4,3,2,1].map(n => {
                const count = reviewStats.data!.distribution[n] ?? 0;
                const pct = reviewStats.data!.count > 0 ? (count / reviewStats.data!.count) * 100 : 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-xs">
                    <span className="w-3 text-slate-500 dark:text-slate-400">{n}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700/60 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-6 text-right text-slate-400">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Per-master breakdown (monitoring) ───────────────────────────── */}
      {enabled && (breakdown.data?.length ?? 0) > 0 && (
        <div className="glass-card rounded-2xl p-5" data-testid="reviews-master-breakdown">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Оценки по мастерам</h3>
          <div className="space-y-2">
            {breakdown.data!.map((m) => (
              <div key={m.masterId} className="flex items-center gap-3 text-sm" data-testid="reviews-master-row">
                <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{m.masterName ?? "Мастер"}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-amber-500 tabular-nums">
                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {m.avg || "—"}
                </span>
                <span className="w-12 text-right text-xs text-slate-400 tabular-nums">{m.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Review list ─────────────────────────────────────────────────── */}
      {reviewList.isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="glass-card rounded-2xl h-24 animate-pulse" />)}</div>
      ) : (reviewList.data?.reviews ?? []).length === 0 ? (
        <EmptyState icon={Star} title={t("salon.noReviews", lang)} description={t("salon.empty.reviews", lang)} />
      ) : (
        <div className="space-y-2.5">
          {(reviewList.data?.reviews ?? []).map((rev: any) => (
            <ReviewCard key={rev.id} rev={rev} tenantId={tenantId} />
          ))}
        </div>
      )}
    </div>
  );
}
