"use client";

import Link from "next/link";
import { CheckCircle2, AlertTriangle, Pin, PinOff, ArrowUpRight } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { PluginIcon } from "./PluginIcon";
import { LockedFeatureCard } from "./LockedFeatureCard";
import { usePinnedPlugins } from "~/lib/plugins/pinnedPlugins";
import type { CatalogCard } from "@plugins/types";

function categoryLabel(cat: CatalogCard["category"], lang: Lang): string {
  return t(`plugins.cat.${cat}` as never, lang);
}

function statusBadge(card: CatalogCard, lang: Lang): React.ReactNode {
  if (card.status === "beta") {
    return (
      <span
        data-testid="plugin-status-badge"
        data-status="beta"
        className="text-[9px] uppercase tracking-wider font-semibold rounded-full px-1.5 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/30 whitespace-nowrap"
      >
        {t("plugins.status.beta", lang)}
      </span>
    );
  }
  if (card.installed && card.enabled) {
    return (
      <span
        data-testid="plugin-status-badge"
        data-status="installed"
        className="text-[9px] uppercase tracking-wider font-semibold rounded-full px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-0.5 whitespace-nowrap"
      >
        <CheckCircle2 size={9} />
        {t("plugins.card.installed", lang)}
      </span>
    );
  }
  if (card.installed && !card.enabled) {
    return (
      <span
        data-testid="plugin-status-badge"
        data-status="disabled"
        className="text-[9px] uppercase tracking-wider font-semibold rounded-full px-1.5 py-0.5 bg-slate-500/10 text-slate-600 dark:text-slate-300 border border-slate-500/30 inline-flex items-center gap-0.5 whitespace-nowrap"
      >
        <AlertTriangle size={9} />
        {t("plugins.card.disabled", lang)}
      </span>
    );
  }
  return null;
}

export function PluginCard({ card }: { card: CatalogCard }) {
  const { lang } = useLang();
  const { isPinned, toggle } = usePinnedPlugins();
  const pinned = isPinned(card.slug);
  const href = `/plugins/${card.slug}`;

  const body = (
    <div
      data-testid="plugin-card"
      data-slug={card.slug}
      data-category={card.category}
      data-status={card.status}
      data-installed={card.installed ? "1" : "0"}
      data-lang={lang}
      className="group relative flex flex-col h-full min-h-[188px] rounded-2xl border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-slate-900/60 p-4 sm:p-5 transition-all duration-200 ease-out hover:border-brand-500/50 dark:hover:border-brand-400/40 hover:shadow-[0_4px_24px_-8px] hover:shadow-brand-500/15 dark:hover:shadow-brand-400/10 hover:-translate-y-0.5"
    >
      {/* Pin button — absolute top-right so it never fights badges. */}
      {card.installed && (
        <button
          type="button"
          data-testid="plugin-card-pin"
          data-pinned={pinned ? "1" : "0"}
          aria-label={pinned ? t("plugins.unpin", lang) : t("plugins.pin", lang)}
          title={pinned ? t("plugins.unpin", lang) : t("plugins.pin", lang)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle(card.slug);
          }}
          className={`absolute top-3 right-3 z-10 h-6 w-6 inline-flex items-center justify-center rounded-md transition-all ${
            pinned
              ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
              : "bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 opacity-0 group-hover:opacity-100"
          }`}
        >
          {pinned ? <Pin size={12} fill="currentColor" /> : <PinOff size={12} />}
        </button>
      )}

      {/* Header row: icon (left) + status badge (right, safely spaced from pin) */}
      <div className="flex items-start gap-3">
        <PluginIcon name={card.iconName} tint={card.iconTint} size={22} />
        <div className="flex-1 min-w-0 flex items-start justify-end pr-7">
          {statusBadge(card, lang)}
        </div>
      </div>

      {/* Name + tagline — reserved height so cards align to the same grid */}
      <div className="mt-3 flex-1 min-h-[64px]">
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
          {card.name}
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400 line-clamp-2">
          {card.tagline}
        </p>
      </div>

      {/* Category pill — subtle chip below content, never clashes with overlays */}
      <div className="mt-3 flex items-center gap-2">
        <span
          data-testid="plugin-card-category"
          className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-white/[0.04]"
        >
          {categoryLabel(card.category, lang)}
        </span>
      </div>

      {/* Footer — billing label + CTA */}
      <div className="mt-3 pt-3 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-white/[0.06]">
        <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200">
          {card.billingLabel}
        </span>
        <Link
          href={href}
          className="text-[12px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 inline-flex items-center gap-0.5 group/cta"
        >
          {card.installed ? t("plugins.card.open", lang) : t("plugins.card.learnMore", lang)}
          <ArrowUpRight size={12} className="transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
        </Link>
      </div>
    </div>
  );

  return <LockedFeatureCard reason={card.lock}>{body}</LockedFeatureCard>;
}
