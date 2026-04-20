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
  if (r.kind === "plan") return `${t("plugins.lock.plan", lang)}: ${r.required.toUpperCase()}`;
  return null;
}

function reasonStyle(r: PluginLockReason): { overlay: string; badge: string } {
  if (r.kind === "coming_soon") {
    return {
      overlay: "bg-slate-100/60 dark:bg-slate-900/60 backdrop-blur-[1px] grayscale",
      badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    };
  }
  if (r.kind === "plan") {
    return {
      overlay: "bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]",
      badge: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    };
  }
  return {
    overlay: "bg-slate-100/70 dark:bg-slate-900/70 backdrop-blur-[1px] grayscale",
    badge: "bg-slate-400/15 text-slate-600 dark:text-slate-300 border-slate-400/30",
  };
}

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
  const style = reasonStyle(reason);
  return (
    <div
      className="relative"
      data-testid="locked-feature-card"
      data-lock-kind={reason.kind}
    >
      <div className="pointer-events-none opacity-70">{children}</div>
      <div
        className={`absolute inset-0 rounded-2xl flex items-end justify-center p-3 ${style.overlay}`}
        aria-hidden="false"
      >
        <span
          className={`text-[11px] uppercase tracking-wider font-semibold rounded-full px-2.5 py-1 border ${style.badge}`}
          role="status"
        >
          {label}
        </span>
      </div>
    </div>
  );
}
