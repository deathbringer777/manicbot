"use client";

import { t, type Lang } from "~/lib/i18n";

export type BillingCycle = "monthly" | "annual";

interface CycleToggleProps {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  lang: Lang;
}

export function CycleToggle({ value, onChange, lang }: CycleToggleProps) {
  return (
    <div className="flex flex-col items-center gap-2 sm:items-end">
      <div
        role="tablist"
        aria-label={t("billing.changePlan", lang)}
        className="relative inline-flex items-center rounded-full border border-slate-200 bg-white p-1 text-xs shadow-sm dark:border-white/10 dark:bg-white/[0.04]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={value === "monthly"}
          data-cycle="monthly"
          onClick={() => onChange("monthly")}
          className={`relative z-10 rounded-full px-4 py-1.5 font-medium transition-colors ${
            value === "monthly"
              ? "text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.55)]"
              : "text-slate-600 hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
          }`}
          style={
            value === "monthly"
              ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }
              : undefined
          }
        >
          {t("billing.monthly", lang)}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === "annual"}
          data-cycle="annual"
          onClick={() => onChange("annual")}
          className={`relative z-10 rounded-full px-4 py-1.5 font-medium transition-colors ${
            value === "annual"
              ? "text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.55)]"
              : "text-slate-600 hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
          }`}
          style={
            value === "annual"
              ? { background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }
              : undefined
          }
        >
          {t("billing.yearly", lang)}
          <span
            className="pointer-events-none absolute -right-3 -top-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm"
            style={{ background: "linear-gradient(135deg,#e11d48,#f43f5e)" }}
            data-testid="annual-badge"
          >
            {t("billing.cycle.annualFree", lang)}
          </span>
        </button>
      </div>
      {value === "annual" && (
        <p
          className="text-[11px] text-emerald-600 dark:text-emerald-400"
          data-testid="annual-subtitle"
        >
          {t("billing.cycle.annualSubtitle", lang)}
        </p>
      )}
    </div>
  );
}
