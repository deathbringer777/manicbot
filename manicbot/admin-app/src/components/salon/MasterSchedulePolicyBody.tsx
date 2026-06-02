"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type TranslationKey } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { Btn } from "~/components/salon/SalonShared";
import {
  MASTER_SCHEDULE_POLICIES,
  DEFAULT_MASTER_SCHEDULE_POLICY,
  isMasterSchedulePolicy,
  type MasterSchedulePolicy,
} from "~/lib/masterSchedulePolicy";

/**
 * Body of the "Кто меняет часы мастеров" chip — a single dropdown that sets the
 * salon-level master-schedule policy. Persisted under `salon.masterSchedulePolicy`
 * via `updateSalonProfile`; enforced server-side in `master.updateWorkHours`.
 */
const POLICY_LABEL_KEY: Record<MasterSchedulePolicy, TranslationKey> = {
  salon_only: "salon.masterSchedulePolicy.salon_only",
  master_free: "salon.masterSchedulePolicy.master_free",
  master_approval: "salon.masterSchedulePolicy.master_approval",
};

export function MasterSchedulePolicyBody({
  tenantId,
  profile,
}: {
  tenantId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any;
}) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const initial = isMasterSchedulePolicy(profile?.salon?.masterSchedulePolicy)
    ? (profile.salon.masterSchedulePolicy as MasterSchedulePolicy)
    : DEFAULT_MASTER_SCHEDULE_POLICY;
  const [policy, setPolicy] = useState<MasterSchedulePolicy>(initial);

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
        {t("salon.masterSchedulePolicy.hint", lang)}
      </p>
      <select
        value={policy}
        onChange={(e) => setPolicy(e.target.value as MasterSchedulePolicy)}
        disabled={update.isPending}
        data-testid="master-schedule-policy-select"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 disabled:opacity-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-100"
      >
        {MASTER_SCHEDULE_POLICIES.map((p) => (
          <option key={p} value={p}>
            {t(POLICY_LABEL_KEY[p], lang)}
          </option>
        ))}
      </select>
      <Btn
        onClick={() => update.mutate({ tenantId, masterSchedulePolicy: policy })}
        disabled={update.isPending}
        className="w-full justify-center py-2.5"
      >
        {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {t("common.save", lang)}
      </Btn>
    </div>
  );
}
