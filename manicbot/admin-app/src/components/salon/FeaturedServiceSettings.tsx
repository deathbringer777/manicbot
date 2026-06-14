"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { Select, type SelectOption } from "~/components/ui/Select";

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Web-chat "featured service" picker. The chosen service's card is shown right
 * under the welcome message (Worker `resolveFeaturedServiceId`). `'auto'` (the
 * default) lets the bot pick the most-booked → first-with-photos service. Only
 * services that actually have photos are offered, so a manual pin always renders
 * a real card; everything else stays under "Auto".
 */
export function FeaturedServiceSettings({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const featured = api.salon.getFeaturedService.useQuery({ tenantId });
  const servicesQuery = api.salon.getServices.useQuery({ tenantId });
  const setFeatured = api.salon.setFeaturedService.useMutation({
    onSuccess: () => {
      void utils.salon.getFeaturedService.invalidate({ tenantId });
    },
  });

  const rows = (servicesQuery.data ?? []) as Array<{
    svcId: string;
    emoji: string | null;
    names: string | null;
    photos: string | null;
    active: number;
    hidden: number;
  }>;

  const serviceOptions: SelectOption[] = rows
    .filter((r) => r.active === 1 && r.hidden === 0 && parseJson<string[]>(r.photos, []).length > 0)
    .map((r) => {
      const names = parseJson<Record<string, string>>(r.names, {});
      const name = names[lang] || names.ru || r.svcId;
      const photoCount = parseJson<string[]>(r.photos, []).length;
      return {
        value: r.svcId,
        label: `${r.emoji ? r.emoji + " " : ""}${name}`,
        sublabel: `${photoCount} 📷`,
      };
    });

  const options: SelectOption[] = [
    { value: "auto", label: t("channels.webChat.featured.auto", lang) },
    ...serviceOptions,
  ];

  const saved = featured.data?.svcId ?? "auto";
  // A pin that no longer maps to a photo-bearing service falls back to "auto"
  // in the UI (the Worker resolves it the same way).
  const current = options.some((o) => o.value === saved) ? saved : "auto";
  const loading = featured.isLoading || servicesQuery.isLoading;

  return (
    <section className="glass-card rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          {t("channels.webChat.featured.title", lang)}
        </h3>
        {setFeatured.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-400" />}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t("channels.webChat.featured.hint", lang)}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
        </div>
      ) : (
        <>
          <Select
            value={current}
            onChange={(v) => setFeatured.mutate({ tenantId, svcId: v })}
            options={options}
            disabled={setFeatured.isPending}
            testIdPrefix="featured-service"
          />
          {current === "auto" && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("channels.webChat.featured.autoHint", lang)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
