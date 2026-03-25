"use client";

import { useState } from "react";
import { Settings, X } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t, LANGS } from "~/lib/i18n";

export function SettingsSheet() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center h-8 w-8 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:bg-slate-700 transition-colors shrink-0"
        title={t("settings.title", lang)}
      >
        <Settings className="h-4 w-4 text-slate-400" />
      </button>

      {/* Sheet overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg bg-slate-900 border border-slate-700/50 rounded-t-3xl p-6 pb-10 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">{t("settings.title", lang)}</h2>
              <button
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Language picker */}
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-3">
                {t("settings.language", lang)}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {LANGS.map(({ code, flag, label }) => (
                  <button
                    key={code}
                    onClick={() => setLang(code)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-2xl border transition-all ${
                      lang === code
                        ? "bg-brand-500/20 border-brand-500/50 text-brand-300"
                        : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    <span className="text-2xl">{flag}</span>
                    <span className="text-xs font-bold">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
