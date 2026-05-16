"use client";

import { useState } from "react";
import { ExternalLink, CalendarClock, AlertCircle } from "lucide-react";
import { api } from "~/trpc/react";
import { t, type Lang } from "~/lib/i18n";
import type { BillingCycle } from "./CycleToggle";

interface SubscriptionManagementProps {
  tenantId: string;
  plan: string | null;
  billingStatus: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: number | null;
  stripeCustomerId: string | null;
  cycle: BillingCycle;
  monthlyPrice: number | null;
  annualMonthlyPrice: number | null;
  currency: string;
  lang: Lang;
}

function formatDate(unix: number | null, lang: Lang): string {
  if (!unix) return "—";
  const date = new Date(unix * 1000);
  const localeMap: Record<Lang, string> = {
    ru: "ru-RU",
    ua: "uk-UA",
    en: "en-US",
    pl: "pl-PL",
  };
  return date.toLocaleDateString(localeMap[lang], {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function statusLabel(status: string | null, cancelAt: number | null, lang: Lang): { text: string; tone: "ok" | "warn" | "err" } {
  if (cancelAt) return { text: t("billing.manage.statusCanceled", lang), tone: "warn" };
  switch (status) {
    case "active":
      return { text: t("billing.manage.statusActive", lang), tone: "ok" };
    case "grace_period":
      return { text: t("billing.manage.statusGrace", lang), tone: "warn" };
    case "past_due":
      return { text: t("billing.manage.statusPastDue", lang), tone: "err" };
    case "canceled":
    case "inactive":
      return { text: t("billing.manage.statusCanceled", lang), tone: "warn" };
    default:
      return { text: status ?? "—", tone: "ok" };
  }
}

export function SubscriptionManagement({
  tenantId,
  plan,
  billingStatus,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  stripeCustomerId,
  cycle,
  monthlyPrice,
  annualMonthlyPrice,
  currency,
  lang,
}: SubscriptionManagementProps) {
  const [opening, setOpening] = useState(false);
  const [portalError, setPortalError] = useState<string>("");

  const openPortal = api.salon.createBillingPortalSession.useMutation({
    onSuccess: (res) => {
      setOpening(false);
      if (res.url) window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (e) => {
      setOpening(false);
      setPortalError(e.message || t("billing.manage.portalFailed", lang));
    },
  });

  function handleOpenPortal() {
    if (!stripeCustomerId) {
      setPortalError(t("billing.manage.portalFailed", lang));
      return;
    }
    setPortalError("");
    setOpening(true);
    openPortal.mutate({ tenantId });
  }

  const { text: statusText, tone } = statusLabel(billingStatus, cancelAtPeriodEnd, lang);
  const toneClasses =
    tone === "ok"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-red-500/15 text-red-600 dark:text-red-400";

  const monthlyPriceForCycle = cycle === "annual" ? annualMonthlyPrice : monthlyPrice;
  const periodTotal =
    cycle === "annual" && annualMonthlyPrice
      ? annualMonthlyPrice * 12
      : monthlyPriceForCycle;
  const nextChargeDate = cancelAtPeriodEnd ?? currentPeriodEnd;
  const nextChargeLabel = cancelAtPeriodEnd
    ? t("billing.manage.cancelsAt", lang)
    : t("billing.manage.nextCharge", lang);

  return (
    <div
      data-testid="subscription-management"
      className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.02]"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t("billing.manage.title", lang)}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-white/60">
            {plan ? plan.toUpperCase() : "—"} ·{" "}
            {cycle === "annual" ? t("billing.yearly", lang) : t("billing.monthly", lang)}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneClasses}`}>
          {statusText}
        </span>
      </div>

      {nextChargeDate && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-white/50">
              {nextChargeLabel}
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              {formatDate(nextChargeDate, lang)}
              {periodTotal && !cancelAtPeriodEnd && (
                <span className="ml-2 text-slate-500 dark:text-white/60">
                  · {periodTotal} {currency}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {portalError && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/40 dark:bg-red-900/20">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-xs text-red-700 dark:text-red-300">{portalError}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handleOpenPortal}
        disabled={opening || !stripeCustomerId}
        data-testid="open-portal"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/[0.08]"
      >
        {opening ? (
          t("billing.manage.openingPortal", lang)
        ) : (
          <>
            <span>{t("billing.manage.openPortal", lang)}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </>
        )}
      </button>
      <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-white/50">
        {t("billing.manage.openPortalHint", lang)}
      </p>
    </div>
  );
}
