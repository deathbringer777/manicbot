"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SectionHeader } from "~/components/dashboard-ui";

export function ClientsTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const clients = api.salon.getClients.useQuery({ tenantId });

  return (
    <div className="space-y-3">
      <SectionHeader title={t("salon.clients", lang)} />
      {clients.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {clients.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
      <div className="space-y-2">
        {clients.data?.map((c: any) => (
          <div key={c.chatId} className="glass-card rounded-xl p-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-sm font-bold text-slate-600 dark:text-slate-400 shrink-0">
              {(c.name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-900 dark:text-white text-sm">{c.name ?? `#${c.chatId}`}</p>
              <p className="text-[10px] text-slate-500">
                {c.tgUsername ? `@${c.tgUsername}` : ""} {c.phone ?? ""}
              </p>
            </div>
          </div>
        ))}
        {clients.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noClients", lang)}</p>}
      </div>
    </div>
  );
}
