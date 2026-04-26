"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { SectionHeader } from "~/components/salon/SalonShared";
import { t, type Lang } from "~/lib/i18n";

interface BillingData {
  plan?: string | null;
  billingStatus?: string | null;
  nextPaymentDate?: number | null;
}
interface Props {
  tenantId: string;
  billing: {
    data?: BillingData;
    isLoading: boolean;
    isError: boolean;
  };
  lang: Lang;
}

const PLAN_PRICES = {
  monthly: { start: "45 zł", pro: "60 zł", max: "90 zł" },
  annual: { start: "36 zł", pro: "48 zł", max: "72 zł" },
} as const;

export function BillingTabContent({ tenantId, billing, lang }: Props) {
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [upgrading, setUpgrading] = useState<string | null>(null);

  const checkout = api.salon.createCheckoutSession.useMutation({
    onSuccess: (res) => {
      if (res.url) window.location.href = res.url;
    },
    onError: (e) => {
      alert(e.message || t("billing.openFailed", lang));
      setUpgrading(null);
    },
  });

  function upgrade(plan: "start" | "pro" | "max") {
    setUpgrading(plan);
    checkout.mutate({ tenantId, plan, locale: lang, billingCycle: cycle });
  }

  const currentPlan = (billing.data?.plan ?? "start").toLowerCase();

  return (
    <div className="space-y-5">
      <SectionHeader title={t("salon.billingTitle", lang)} />

      {billing.isLoading && <Loader2 className="animate-spin text-brand-400 mx-auto" />}
      {billing.isError && (
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-400">{t("common.errorLoading", lang)}</p>
        </div>
      )}

      {billing.data && (
        <div className="glass-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.plan", lang)}</span>
            <span className="font-bold text-slate-900 dark:text-white text-lg">{currentPlan.toUpperCase()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.status", lang)}</span>
            <span
              className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                billing.data.billingStatus === "active"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/15 text-amber-400"
              }`}
            >
              {t(`billing.${billing.data.billingStatus ?? "trialing"}` as "billing.active", lang)}
            </span>
          </div>
          {billing.data.nextPaymentDate && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400 text-sm">{t("billing.nextPayment", lang)}</span>
              <span className="text-slate-900 dark:text-white text-sm">
                {new Date(billing.data.nextPaymentDate * 1000).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Upgrade — billing cycle toggle */}
      <div className="glass-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("billing.changePlan", lang)}
          </h3>
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-xs dark:border-white/10 dark:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              className={`rounded-full px-4 py-1.5 font-medium transition ${
                cycle === "monthly"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 dark:text-white/60"
              }`}
            >
              {t("billing.monthly", lang)}
            </button>
            <button
              type="button"
              onClick={() => setCycle("annual")}
              className={`relative rounded-full px-4 py-1.5 font-medium transition ${
                cycle === "annual"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-600 dark:text-white/60"
              }`}
            >
              {t("billing.yearly", lang)}
              <span
                className="pointer-events-none absolute -right-2 -top-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white"
                style={{ background: "linear-gradient(135deg,#e11d48,#f43f5e)" }}
              >
                −20%
              </span>
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {(["start", "pro", "max"] as const).map((p) => (
            <div
              key={p}
              className={`rounded-xl border p-4 transition ${
                currentPlan === p
                  ? "border-emerald-400/50 bg-emerald-500/[0.05]"
                  : "border-slate-200 bg-white/[0.03] dark:border-white/10"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase text-slate-500 dark:text-white/60">{p}</span>
                {currentPlan === p && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">{t("billing.current", lang)}</span>
                )}
              </div>
              <div className="mb-3 font-mono text-2xl font-bold text-slate-900 dark:text-white">
                {PLAN_PRICES[cycle][p]}
                <span className="ml-1 text-xs text-slate-500">{t("billing.perMonth", lang)}</span>
              </div>
              <button
                type="button"
                onClick={() => upgrade(p)}
                disabled={upgrading !== null || (currentPlan === p && cycle === "monthly")}
                className="w-full rounded-lg py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
              >
                {upgrading === p ? "…" : currentPlan === p && cycle === "annual" ? t("billing.switchToYearly", lang) : t("billing.choose", lang)}
              </button>
            </div>
          ))}
        </div>
        {cycle === "annual" && (
          <p className="text-[11px] text-slate-500 dark:text-white/40">
            {t("billing.yearlyDiscount", lang)}
          </p>
        )}
      </div>
    </div>
  );
}
