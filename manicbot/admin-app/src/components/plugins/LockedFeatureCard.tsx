"use client";

/**
 * Wraps a child card with a lock overlay and reason label. Used to show
 * plugins that the viewer cannot install because of role, plan, or
 * coming-soon status. Overlay styling varies by `reason.kind`.
 */

import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import type { PluginLockReason } from "@plugins/types";
import type { Lang } from "~/lib/i18n";

function reasonText(r: PluginLockReason, lang: Lang): string | null {
  if (r.kind === "none") return null;
  if (r.kind === "coming_soon") return t("plugins.lock.comingSoon", lang);
  if (r.kind === "role_mismatch") return t("plugins.lock.roleMismatch", lang);
  if (r.kind === "platform_only") return t("plugins.lock.platformOnly", lang);
  if (r.kind === "plan") return `${t("plugins.lock.planBadge", lang)}: ${r.required.toUpperCase()}`;
  return null;
}

function reasonBadge(r: PluginLockReason): string {
  if (r.kind === "coming_soon") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40";
  }
  if (r.kind === "plan") {
    return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40";
  }
  return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/40";
}

/**
 * Renders a corner badge instead of covering the whole card — name/tagline
 * stay readable, only the CTA is disabled. Greyscale is replaced with a
 * light opacity so info remains accessible.
 */
export function LockedFeatureCard({
  reason,
  children,
}: {
  reason: PluginLockReason;
  children: React.ReactNode;
}) {
  const { lang } = useLang();
  const label = reasonText(reason, lang);
  if (!label || reason.kind === "none") return <>{children}</>;
  const badgeClass = reasonBadge(reason);
  const softenBody = reason.kind === "coming_soon" || reason.kind === "role_mismatch";
  return (
    <div
      className="relative"
      data-testid="locked-feature-card"
      data-lock-kind={reason.kind}
    >
      <div className={softenBody ? "opacity-75" : ""}>{children}</div>
      <span
        className={`absolute top-2 right-2 text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 border shadow-sm pointer-events-none whitespace-nowrap ${badgeClass}`}
        role="status"
      >
        {label}
      </span>
    </div>
  );
}
