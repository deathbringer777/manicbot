"use client";

import Link from "next/link";
import { CheckCircle2, AlertTriangle, Pin, PinOff, ArrowUpRight, Settings as SettingsIcon } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { PluginIcon } from "./PluginIcon";
import { LockedFeatureCard } from "./LockedFeatureCard";
import { usePinnedPlugins } from "~/lib/plugins/pinnedPlugins";
import { toast } from "~/lib/toast";
import { useEffect, useRef } from "react";
import { getPlugin } from "@plugins/index";
import { hasRuntime } from "./runtimePanels";
import type { CatalogCard } from "@plugins/types";

function categoryLabel(cat: CatalogCard["category"], lang: Lang): string {
  return t(`plugins.cat.${cat}` as never, lang);
}

/**
 * Chooses a single authoritative badge for the card.
 * Precedence: lock reason > installed/disabled > beta > nothing.
 * Prevents contradictory pairs like "installed + unavailable for your role".
 */
function renderBadge(card: CatalogCard, lang: Lang): React.ReactNode {
  // When the card is locked, the LockedFeatureCard wrapper already renders a
  // corner badge explaining the reason — suppress any status badge here to
  // avoid the double-label that confused users.
  if (card.lock.kind !== "none") return null;

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
  return null;
}

export function PluginCard({ card }: { card: CatalogCard }) {
  const { lang } = useLang();
  const { isPinned, toggle, error: pinError } = usePinnedPlugins();
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (pinError && pinError !== lastErrorRef.current) {
      lastErrorRef.current = pinError;
      if (pinError === "pin_limit_reached") {
        toast.error(t("plugins.pin.limit", lang));
      }
    }
  }, [pinError, lang]);
  const pinned = isPinned(card.slug);
  const detailHref = `/plugins/${card.slug}`;
  const actionable = card.installed && card.lock.kind === "none";
  const plugin = getPlugin(card.slug);
  const hasSettingsPanel = !!plugin?.manifest.capabilities.settingsPanel;
  const settingsHref = plugin?.manifest.capabilities.settingsPanel
    ? `/settings?section=${plugin.manifest.capabilities.settingsPanel.sectionKey}`
    : null;
  // "Open" for installed plugins with a runtime goes to the dedicated runtime page.
  const openHref = card.installed && hasRuntime(card.slug)
    ? `/plugin/${card.slug}`
    : detailHref;

  const body = (
    <div
      data-testid="plugin-card"
      data-slug={card.slug}
      data-category={card.category}
      data-status={card.status}
      data-installed={card.installed ? "1" : "0"}
      data-actionable={actionable ? "1" : "0"}
      data-lang={lang}
      className="group relative flex flex-col h-full min-h-[200px] rounded-2xl border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-slate-900/60 p-4 sm:p-5 transition-all duration-200 ease-out hover:border-brand-500/50 dark:hover:border-brand-400/40 hover:shadow-[0_4px_24px_-8px] hover:shadow-brand-500/15 dark:hover:shadow-brand-400/10 hover:-translate-y-0.5"
    >
      {/* Pin button — visible (not hover-only) when plugin is actionable. */}
      {actionable && (
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
          className={`absolute top-3 right-3 z-10 h-7 w-7 inline-flex items-center justify-center rounded-lg transition-colors ${
            pinned
              ? "bg-amber-500/20 text-amber-500 hover:bg-amber-500/30"
              : "bg-slate-100 dark:bg-white/[0.04] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/[0.08]"
          }`}
        >
          {pinned ? <Pin size={13} fill="currentColor" /> : <PinOff size={13} />}
        </button>
      )}

      {/* Header: icon + status badge */}
      <div className="flex items-start gap-3">
        <PluginIcon name={card.iconName} tint={card.iconTint} size={22} />
        <div className="flex-1 min-w-0 flex items-start justify-end pr-9">
          {renderBadge(card, lang)}
        </div>
      </div>

      {/* Name + tagline */}
      <div className="mt-3 flex-1 min-h-[64px]">
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 line-clamp-1 leading-tight">
          {card.name}
        </h3>
        <p className="mt-1.5 text-[12.5px] leading-snug text-slate-500 dark:text-slate-400 line-clamp-2">
          {card.tagline}
        </p>
      </div>

      {/* Category pill */}
      <div className="mt-3 flex items-center gap-2">
        <span
          data-testid="plugin-card-category"
          className="text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-white/[0.04]"
        >
          {categoryLabel(card.category, lang)}
        </span>
      </div>

      {/* Footer: billing + quick actions */}
      <div className="mt-3 pt-3 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-white/[0.06]">
        <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200 truncate">
          {card.billingLabel}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {actionable && hasSettingsPanel && settingsHref && (
            <Link
              href={settingsHref}
              data-testid="plugin-card-settings"
              aria-label={t("plugins.settings.title", lang)}
              title={t("plugins.settings.title", lang)}
              onClick={(e) => e.stopPropagation()}
              className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/[0.08] transition-colors"
            >
              <SettingsIcon size={13} />
            </Link>
          )}
          <Link
            href={openHref}
            data-testid="plugin-card-cta"
            className="text-[12px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 inline-flex items-center gap-0.5 group/cta px-2 py-1"
          >
            {card.installed ? t("plugins.card.open", lang) : t("plugins.card.learnMore", lang)}
            <ArrowUpRight size={12} className="transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );

  return <LockedFeatureCard reason={card.lock}>{body}</LockedFeatureCard>;
}
