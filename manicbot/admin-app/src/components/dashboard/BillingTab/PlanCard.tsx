"use client";

import { Check, Sparkles, Crown, Rocket } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import type { BillingCycle } from "./CycleToggle";

export type PlanId = "start" | "pro" | "max";

export interface PlanCardData {
  id: PlanId;
  name: string;
  monthlyPrice: number;
  annualMonthlyPrice: number;
  currency: string;
  popular: boolean;
  subtitle: string;
  features: string[];
}

interface PlanCardProps {
  plan: PlanCardData;
  cycle: BillingCycle;
  currentPlan: PlanId | null;
  /** Whether the user has an active (paid) subscription on the current plan + cycle. */
  isCurrentActive: boolean;
  upgrading: boolean;
  onSelect: (plan: PlanId) => void;
  lang: Lang;
}

const PLAN_ICONS: Record<PlanId, React.ComponentType<{ className?: string }>> = {
  start: Rocket,
  pro: Sparkles,
  max: Crown,
};

const PLAN_ACCENT: Record<PlanId, { check: string; iconBg: string; iconColor: string }> = {
  start: {
    check: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-100 dark:bg-emerald-500/15",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  pro: {
    check: "text-violet-600 dark:text-violet-300",
    iconBg: "bg-violet-100 dark:bg-violet-500/15",
    iconColor: "text-violet-600 dark:text-violet-300",
  },
  max: {
    check: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-100 dark:bg-amber-500/15",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
};

export function PlanCard({
  plan,
  cycle,
  currentPlan,
  isCurrentActive,
  upgrading,
  onSelect,
  lang,
}: PlanCardProps) {
  const Icon = PLAN_ICONS[plan.id];
  const accent = PLAN_ACCENT[plan.id];
  const isCurrent = currentPlan === plan.id;
  const price = cycle === "annual" ? plan.annualMonthlyPrice : plan.monthlyPrice;
  const annualTotal = plan.annualMonthlyPrice * 12;
  const ctaLabel = isCurrentActive
    ? t("billing.continueWithPlan", lang)
    : t("billing.choosePlan", lang);
  const showAnnualTotal = cycle === "annual";

  return (
    <div
      data-plan-id={plan.id}
      data-popular={plan.popular ? "true" : undefined}
      data-current={isCurrent ? "true" : undefined}
      className={`group relative flex flex-col rounded-2xl border bg-white p-5 transition-shadow dark:bg-white/[0.02] ${
        plan.popular
          ? "border-violet-300/90 shadow-[0_12px_40px_-12px_rgba(124,58,237,0.25)] dark:border-violet-500/40"
          : "border-slate-200 hover:shadow-md dark:border-white/10"
      }`}
    >
      {plan.popular && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md"
          style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
          data-testid="popular-badge"
        >
          {t("billing.popular", lang)}
        </span>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent.iconBg}`}>
            <Icon className={`h-4 w-4 ${accent.iconColor}`} />
          </span>
          <span className="text-sm font-semibold text-slate-900 dark:text-white">{plan.name}</span>
        </div>
        {isCurrent && (
          <span
            className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-600 dark:text-emerald-400"
            data-testid="current-pill"
          >
            {t("billing.current", lang)}
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-slate-500 dark:text-white/60">{plan.subtitle}</p>

      <div className="mb-1 flex items-baseline gap-1">
        <span className="font-mono text-3xl font-bold text-slate-900 dark:text-white">
          {price}
        </span>
        <span className="text-sm font-medium text-slate-600 dark:text-white/70">
          {plan.currency}
        </span>
        <span className="text-xs text-slate-500 dark:text-white/50">{t("billing.perMonth", lang)}</span>
      </div>

      {showAnnualTotal ? (
        <p
          className="mb-4 text-[11px] text-slate-500 dark:text-white/50"
          data-testid="annual-total"
        >
          {t("billing.annualTotal", lang).replace("{total}", `${annualTotal} ${plan.currency}`)}
        </p>
      ) : (
        <p className="mb-4 text-[11px] text-transparent select-none">&nbsp;</p>
      )}

      <ul className="mb-5 flex-1 space-y-2">
        {plan.features.map((feature, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/80">
            <Check className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${accent.check}`} aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => onSelect(plan.id)}
        disabled={upgrading || isCurrentActive}
        data-testid={`select-${plan.id}`}
        className={`w-full rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
          plan.popular ? "hover:opacity-95" : "hover:opacity-90"
        }`}
        style={{
          background: plan.popular
            ? "linear-gradient(135deg,#7c3aed,#06b6d4)"
            : "linear-gradient(135deg,#475569,#1e293b)",
        }}
      >
        {upgrading ? "…" : ctaLabel}
      </button>
    </div>
  );
}
