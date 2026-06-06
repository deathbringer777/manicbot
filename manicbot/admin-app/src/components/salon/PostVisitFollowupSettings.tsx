"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

/**
 * Single opt-in switch: send the client a Telegram review ask ~24h after the
 * visit. The email side of the post-visit follow-up is configured separately
 * as a `post_visit_24h` marketing automation (Marketing → Automations).
 *
 * Backend flag: `tenant_config[post_visit_followup_tg_enabled]`, read by the
 * Worker's `phasePostVisitFollowup` via `getConfig`. Default OFF.
 */
export function PostVisitFollowupSettings({ tenantId, bare = false }: { tenantId: string; bare?: boolean }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const { data, isLoading } = api.salon.getPostVisitFollowupTg.useQuery({ tenantId });
  const set = api.salon.setPostVisitFollowupTg.useMutation({
    onSuccess: () => { utils.salon.getPostVisitFollowupTg.invalidate(); },
  });

  const enabled = data?.enabled ?? false;

  const inner = (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("salon.postVisitFollowup.body", lang)}
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              {t("salon.postVisitFollowup.tg.label", lang)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {t("salon.postVisitFollowup.tg.hint", lang)}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            data-testid="post-visit-followup-tg"
            disabled={set.isPending}
            onClick={() => set.mutate({ tenantId, enabled: !enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors mt-0.5 ${
              enabled ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-600"
            } ${set.isPending ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}
    </>
  );

  if (bare) return <div className="space-y-3">{inner}</div>;

  return <div className="glass-card rounded-2xl p-4 space-y-3">{inner}</div>;
}
