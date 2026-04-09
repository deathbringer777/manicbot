"use client";

import { Globe, Sun, Moon } from "lucide-react";
import { LangPickerInline } from "~/components/layout/Shell";
import { useLang } from "~/components/LangContext";
import { usePublicTheme } from "~/components/public/ThemeProvider";
import { t } from "~/lib/i18n";

export function AppearanceSection() {
  const { lang } = useLang();
  const { theme, setTheme } = usePublicTheme();

  return (
    <div className="space-y-4">
      {/* Theme */}
      <section className="glass-card rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          {theme === "dark" ? (
            <Moon className="w-4 h-4 text-violet-400 shrink-0" />
          ) : (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t("settings.theme", lang)}</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setTheme("light")}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all border ${
              theme === "light"
                ? "bg-brand-500/10 border-brand-500/40 text-brand-600 dark:text-brand-300"
                : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Sun className="w-4 h-4" />
            {t("settings.themeLight", lang)}
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all border ${
              theme === "dark"
                ? "bg-brand-500/10 border-brand-500/40 text-brand-600 dark:text-brand-300"
                : "bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/50 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <Moon className="w-4 h-4" />
            {t("settings.themeDark", lang)}
          </button>
        </div>
      </section>

      {/* Language */}
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
