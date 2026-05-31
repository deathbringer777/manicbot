"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";
import { WorkHoursEditor } from "~/components/salon/WorkHoursEditor";
import { hydrateWorkHours, serializeWorkHours, type WorkHoursState } from "~/lib/workHours";

/**
 * Body of the "Время работы" chip: per-weekday open/close via dropdowns +
 * day-off toggle. Persists as the per-day JSON string under
 * `salon.workHours` (the public salon page + dashboard already decode it).
 */
export function SalonHoursBody({ tenantId, profile }: { tenantId: string; profile: any }) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [hours, setHours] = useState<WorkHoursState>(() => hydrateWorkHours(profile?.salon?.workHours));

  const update = api.salon.updateSalonProfile.useMutation({
    onSuccess: () => {
      utils.salon.getSalonProfile.invalidate();
      toast.success(t("common.saved", lang));
    },
    onError: (e) => toast.error(t("common.saveError", lang), e.message),
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t("salon.publicProfile.scheduleHint", lang)}
      </p>
      <WorkHoursEditor value={hours} onChange={setHours} disabled={update.isPending} />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {t("salon.workHoursHint", lang)}
      </p>
      <Btn
        onClick={() => update.mutate({ tenantId, workHours: serializeWorkHours(hours) })}
        disabled={update.isPending}
        className="w-full justify-center py-2.5"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}
