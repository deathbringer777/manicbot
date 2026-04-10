"use client";

import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { SectionHeader } from "~/components/dashboard-ui";

export function BillingTab({ tenantId }: { tenantId: string }) {
  const { lang } = useLang();
  const billing = api.salon.getBillingStatus.useQuery({ tenantId });

  return (
    <div className="space-y-4">
      <SectionHeader title={t("salon.billingTitle", lang)} />
      {billing.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {billing.isError && <div className="glass-card rounded-2xl p-6 text-center"><p className="text-red-400">Ошибка загрузки. Попробуйте обновить.</p></div>}
      {billing.data && (
        <div className="glass-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.plan", lang)}</span>
            <span className="font-bold text-slate-900 dark:text-white text-lg">{(billing.data.plan ?? "start").toUpperCase()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.status", lang)}</span>
            <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
              billing.data.billingStatus === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
            }`}>
              {t(`billing.${billing.data.billingStatus ?? "trialing"}` as any, lang)}
            </span>
          </div>
          {billing.data.nextPaymentDate && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.nextPayment", lang)}</span>
              <span className="text-slate-900 dark:text-white text-sm">{new Date(billing.data.nextPaymentDate * 1000).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
