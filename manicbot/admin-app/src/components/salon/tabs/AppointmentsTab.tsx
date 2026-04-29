"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { AptCard } from "~/components/dashboard-ui";

export function AppointmentsTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();

  const apts = api.salon.getAppointments.useQuery({ tenantId });
  const updateAptStatus = api.salon.updateAppointmentStatus.useMutation({
    onSuccess: () => { utils.salon.getAppointments.invalidate(); },
  });
  const markNoShow = api.salon.markNoShow.useMutation({
    onSuccess: () => { utils.salon.getAppointments.invalidate(); },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex-1">{t("salon.appointments", lang)}</h2>
      </div>
      {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {apts.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">{t("common.errorLoading", lang)}</p></div>}
      <div className="space-y-2">
        {apts.data?.map((a: any) => (
          <AptCard key={a.id} a={a} lang={lang}
            onAction={(id, status) => updateAptStatus.mutate({ tenantId, appointmentId: String(id), status })}
            onNoShow={(id, noShowBy) => markNoShow.mutate({ tenantId, id: String(id), noShowBy })} />
        ))}
        {apts.data?.length === 0 && <p className="text-slate-500 text-sm text-center py-8">{t("salon.noApts", lang)}</p>}
      </div>
    </div>
  );
}
