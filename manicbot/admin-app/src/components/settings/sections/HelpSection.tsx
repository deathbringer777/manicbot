"use client";

import Link from "next/link";
import { HelpCircle, Map } from "lucide-react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { TOUR_REPLAY_EVENT } from "~/lib/onboarding/constants";

export function HelpSection() {
  const { role, previewRole } = useRole();
  const { lang } = useLang();
  const effectiveRole = (role === "system_admin" && previewRole) ? previewRole : role;
  const showTourReplay =
    effectiveRole === "tenant_owner" ||
    effectiveRole === "master" ||
    effectiveRole === "support" ||
    effectiveRole === "technical_support";

  return (
    <div className="space-y-4">
      <section className="glass-card rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-cyan-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.helpCenter", lang)}</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("settings.helpCenterDesc", lang)}</p>
        <Link
          href="/help"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl border border-slate-200 dark:border-slate-600/60 bg-white dark:bg-slate-900/50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-brand-500/40 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          {t("settings.helpCenter", lang)}
        </Link>
        {showTourReplay && (
          <>
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <Map className="w-4 h-4 text-violet-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.tourReplay", lang)}</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("settings.tourReplayDesc", lang)}</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT))}
              className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-200 hover:bg-violet-500/20 transition-colors"
            >
              {t("settings.tourReplay", lang)}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
