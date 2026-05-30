"use client";

import { Loader2, UserRound } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

const TEAM_LABELS = {
  ru: {
    masters: "Мастера",
    noMasters: "Пока никого нет",
  },
  ua: {
    masters: "Майстри",
    noMasters: "Поки нікого немає",
  },
  en: {
    masters: "Masters",
    noMasters: "No one here yet",
  },
  pl: {
    masters: "Mistrzowie",
    noMasters: "Jeszcze nikogo tu nie ma",
  },
} as const;

export function TeamSection() {
  const { tenantId } = useRole();
  const { lang } = useLang();
  const effectiveTenantId = tenantId;
  const labels = TEAM_LABELS[lang];

  if (!effectiveTenantId) {
    return (
      <div className="glass-card rounded-2xl p-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.noTenant", lang)}</p>
      </div>
    );
  }

  const masters = api.salon.getMasters.useQuery({ tenantId: effectiveTenantId });

  return (
    <div className="space-y-5">
      {/* Team list */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">{labels.masters}</h3>
        <div className="glass-card rounded-2xl p-4">
          {masters.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
            </div>
          ) : (masters.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">{labels.noMasters}</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-white/5">
              {masters.data!.map((m: any) => (
                <li key={m.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  {m.photo ? (
                    <img src={m.photo} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400">
                      <UserRound className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{m.name || "—"}</p>
                    {m.bio && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{m.bio}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
