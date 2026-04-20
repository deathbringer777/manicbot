"use client";

import Link from "next/link";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { PluginIcon } from "./PluginIcon";
import { LockedFeatureCard } from "./LockedFeatureCard";
import type { CatalogCard } from "@plugins/types";

function categoryLabel(cat: CatalogCard["category"], lang: Lang): string {
  const key = `plugins.cat.${cat}` as const;
  // key exists in i18n map
  return t(key as never, lang);
}

function statusBadge(card: CatalogCard, lang: Lang): React.ReactNode {
  if (card.status === "beta") {
    return (
      <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30">
        {t("plugins.status.beta", lang)}
      </span>
    );
  }
  if (card.installed && card.enabled) {
    return (
      <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
        <CheckCircle2 size={10} />
        {t("plugins.card.installed", lang)}
      </span>
    );
  }
  if (card.installed && !card.enabled) {
    return (
      <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-slate-500/15 text-slate-500 dark:text-slate-300 border border-slate-500/30 inline-flex items-center gap-1">
        <AlertTriangle size={10} />
        {t("plugins.card.disabled", lang)}
      </span>
    );
  }
  return null;
}

export function PluginCard({ card }: { card: CatalogCard }) {
  const { lang } = useLang();
  const href = `/plugins/${card.slug}`;

  const body = (
    <div
      data-testid="plugin-card"
      data-slug={card.slug}
      data-category={card.category}
      data-status={card.status}
      data-installed={card.installed ? "1" : "0"}
      data-lang={lang}
      className="flex flex-col h-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-4 sm:p-5 transition-all hover:border-slate-300 dark:hover:border-white/20 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <PluginIcon name={card.iconName} tint={card.iconTint} size={22} />
        <div className="flex flex-col items-end gap-1">
          {statusBadge(card, lang)}
          <span className="text-[11px] text-slate-500 dark:text-slate-400">{categoryLabel(card.category, lang)}</span>
        </div>
      </div>
      <div className="mt-3 flex-1 min-h-0">
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
          {card.name}
        </h3>
        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 line-clamp-2">
          {card.tagline}
        </p>
      </div>
      <div className="mt-3 pt-3 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-white/5">
        <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          {card.billingLabel}
        </span>
        <Link
          href={href}
          className="text-[12px] font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {card.installed ? t("plugins.card.open", lang) : t("plugins.card.learnMore", lang)}
        </Link>
      </div>
    </div>
  );

  return <LockedFeatureCard reason={card.lock}>{body}</LockedFeatureCard>;
}
