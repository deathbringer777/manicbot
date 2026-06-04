"use client";

import { useState } from "react";
import { Plus, List, X, ChevronRight } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { SERVICE_TEMPLATES, type ServiceTemplate } from "~/lib/serviceTemplates";
import { Btn } from "~/components/salon/SalonShared";

/** Dropdown: "+ Add" -> "New" / "Templates" */
export function AddServiceDropdown({ lang, onNew, onTemplates }: { lang: Lang; onNew: () => void; onTemplates: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Btn onClick={() => setOpen(p => !p)}>
        <Plus className="h-3.5 w-3.5" />
        {t("action.add", lang)}
      </Btn>
      {open && (
        <>
          <div className="fixed inset-0 z-[59]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-[60] min-w-[168px] max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/60 dark:border-white/10 shadow-2xl overflow-hidden">
            <button
              onClick={() => { setOpen(false); onNew(); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left">
              <Plus className="h-4 w-4 text-brand-500 shrink-0" />
              {t("service.new", lang)}
            </button>
            <div className="h-px bg-slate-100 dark:bg-white/5 mx-3" />
            <button
              onClick={() => { setOpen(false); onTemplates(); }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 transition-colors text-left">
              <List className="h-4 w-4 text-brand-500 shrink-0" />
              {t("service.templates", lang)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Bottom-sheet template picker */
export function ServiceTemplatesSheet({ lang, onClose, onSelect }: { lang: Lang; onClose: () => void; onSelect: (tmpl: ServiceTemplate) => void }) {
  return (
    <div role="dialog" aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-y-auto max-h-[80dvh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 dark:border-white/5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{t("service.templatesTitle", lang)}</h3>
          <button onClick={onClose}
            className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {SERVICE_TEMPLATES.map((tmpl, i) => (
            <button key={i} onClick={() => onSelect(tmpl)}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/5 hover:bg-brand-50 dark:hover:bg-brand-500/10 text-left transition-colors group">
              <span className="text-2xl w-10 h-10 flex items-center justify-center bg-white dark:bg-slate-800 rounded-xl shrink-0 shadow-sm">
                {tmpl.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 dark:text-white text-sm">{tmpl.names[lang] ?? tmpl.names.en}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{tmpl.duration} {t("service.min", lang)} · {tmpl.price} zł</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-400 dark:text-slate-600 group-hover:text-brand-500 transition-colors shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
