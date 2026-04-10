"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { AptCard } from "~/components/dashboard-ui";

export function AppointmentsTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [aptDate, setAptDate] = useState("");

  const apts = api.salon.getAppointments.useQuery({ tenantId, date: aptDate || undefined });
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
        <input type="date" value={aptDate} onChange={e => setAptDate(e.target.value)}
          className="text-xs bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500" />
      </div>
      {apts.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {apts.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
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
