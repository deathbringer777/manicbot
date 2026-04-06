"use client";

import { Globe } from "lucide-react";
import { LangPickerInline } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export function AppearanceSection() {
  const { lang } = useLang();

  return (
    <div className="space-y-4">
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-4 h-4 text-sky-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.language", lang)}</h2>
        </div>
        <LangPickerInline placement="settings" />
      </section>
    </div>
  );
}
