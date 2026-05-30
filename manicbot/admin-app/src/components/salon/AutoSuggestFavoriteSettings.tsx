"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SectionHeader } from "~/components/salon/SalonShared";

/**
 * 0074 — per-channel toggle for the "auto-suggest favorite master"
 * behaviour. Pair to AutoConfirmSettings (identical layout). Two
 * channels:
 *
 *   - `web`      → ManualBookingModal (this dashboard) AND the
 *                  manicbot.com booking widget. When ON, picking a
 *                  returning client pre-selects their favorite master
 *                  (manual pin first, falling back to most-frequent
 *                  master from history).
 *   - `telegram` → bot booking flow. When ON, the favorite is starred
 *                  ⭐ and floated to the top of the master picker.
 *
 * Defaults are wired in two places (kept in lockstep):
 *   * admin-app: `salon.getAutoSuggestFavoriteSettings` (defaults true)
 *   * Worker:    `src/services/services.js:FAVORITE_SUGGEST_DEFAULTS`
 */
export function AutoSuggestFavoriteSettings({ tenantId, bare = false }: { tenantId: string; bare?: boolean }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const { data, isLoading } = api.salon.getAutoSuggestFavoriteSettings.useQuery({ tenantId });
  const set = api.salon.setAutoSuggestFavorite.useMutation({
    onSuccess: () => { utils.salon.getAutoSuggestFavoriteSettings.invalidate(); },
  });

  const channels: Array<{ key: "web" | "telegram"; label: string; hint: string }> = [
    { key: "web",      label: t("salon.channels.web.label", lang), hint: t("salon.favoriteSuggest.web.hint", lang) },
    { key: "telegram", label: "Telegram",                          hint: t("salon.favoriteSuggest.telegram.hint", lang) },
  ];

  const inner = (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t("salon.favoriteSuggest.body", lang)}
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
        </div>
      ) : (
        channels.map((ch) => {
          const enabled = data?.[ch.key] ?? true;
          return (
            <div key={ch.key} className="flex items-start justify-between gap-3 py-2 border-t border-slate-200 dark:border-white/5 first:border-t-0 first:pt-0">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{ch.label}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{ch.hint}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                data-testid={`fav-suggest-toggle-${ch.key}`}
                disabled={set.isPending}
                onClick={() => set.mutate({ tenantId, channel: ch.key, enabled: !enabled })}
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
          );
        })
      )}
    </>
  );

  // `bare` renders just the body so a CollapsibleSection owns the title + card.
  if (bare) return <div className="space-y-3">{inner}</div>;

  return (
    <div className="space-y-4">
      <SectionHeader title={t("salon.favoriteSuggest.title", lang)} />
      <div className="glass-card rounded-2xl p-4 space-y-3">{inner}</div>
    </div>
  );
}
