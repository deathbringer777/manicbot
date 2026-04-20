"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { PLUGIN_CATEGORIES, BILLING_MODELS } from "@plugins/types";
import type { PluginCategory, BillingModel } from "@plugins/types";

export interface FilterValue {
  q: string;
  category: PluginCategory | null;
  billing: BillingModel | null;
  installedOnly: boolean;
}

export function PluginFilters({
  value,
  onChange,
}: {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}) {
  const { lang } = useLang();
  const [localQ, setLocalQ] = useState(value.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search propagation (120ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (localQ !== value.q) onChange({ ...value, q: localQ });
    }, 120);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localQ]);

  const billingKey = (m: BillingModel): string => {
    if (m === "free") return "plugins.billing.free";
    if (m === "included_in_plan") return "plugins.billing.includedInPlan";
    if (m === "paid_addon_monthly") return "plugins.billing.paidMonthly";
    return "plugins.billing.paidOnetime";
  };

  const clear = () => {
    setLocalQ("");
    onChange({ q: "", category: null, billing: null, installedOnly: false });
  };

  const hasActive = !!(value.q || value.category || value.billing || value.installedOnly);

  return (
    <div
      data-testid="plugin-filters"
      className="sticky top-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 backdrop-blur bg-white/80 dark:bg-slate-950/70 border-b border-slate-100 dark:border-white/5"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="plugin-filters-search"
              type="search"
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              placeholder={t("plugins.search.placeholder", lang)}
              aria-label={t("plugins.search.placeholder", lang)}
              className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
            {localQ && (
              <button
                type="button"
                aria-label={t("plugins.filters.clear", lang)}
                onClick={() => setLocalQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <label className="hidden sm:inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
            <input
              data-testid="plugin-filters-installed-only"
              type="checkbox"
              checked={value.installedOnly}
              onChange={(e) => onChange({ ...value, installedOnly: e.target.checked })}
              className="accent-brand-500"
            />
            {t("plugins.filters.installed", lang)}
          </label>
          {hasActive && (
            <button
              data-testid="plugin-filters-clear"
              type="button"
              onClick={clear}
              className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 whitespace-nowrap"
            >
              {t("plugins.filters.clear", lang)}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onChange({ ...value, category: null })}
            className={`text-[11px] px-2.5 py-1 rounded-full border ${
              !value.category
                ? "bg-brand-500/10 text-brand-600 dark:text-brand-300 border-brand-500/40"
                : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10"
            }`}
          >
            {t("plugins.filters.all", lang)}
          </button>
          {PLUGIN_CATEGORIES.map((cat) => (
            <button
              key={cat}
              data-testid={`filter-cat-${cat}`}
              type="button"
              onClick={() => onChange({ ...value, category: cat })}
              className={`text-[11px] px-2.5 py-1 rounded-full border ${
                value.category === cat
                  ? "bg-brand-500/10 text-brand-600 dark:text-brand-300 border-brand-500/40"
                  : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10"
              }`}
            >
              {t(`plugins.cat.${cat}` as never, lang)}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-white/10" />
          {BILLING_MODELS.map((m) => (
            <button
              key={m}
              data-testid={`filter-billing-${m}`}
              type="button"
              onClick={() => onChange({ ...value, billing: value.billing === m ? null : m })}
              className={`text-[11px] px-2.5 py-1 rounded-full border ${
                value.billing === m
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/40"
                  : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10"
              }`}
            >
              {t(billingKey(m) as never, lang)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
