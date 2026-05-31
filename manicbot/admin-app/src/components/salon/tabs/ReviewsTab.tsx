"use client";

import { Star } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { EmptyState } from "~/components/ui/EmptyState";
import { ReviewCard } from "~/components/salon/tabs/ReviewCard";

export function ReviewsTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const reviewStats = api.reviews.getStats.useQuery({ tenantId });
  const reviewList = api.reviews.getForSalon.useQuery({ tenantId });

  return (
    <div className="space-y-4">
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
