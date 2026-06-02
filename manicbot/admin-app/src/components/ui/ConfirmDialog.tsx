"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";

export type ConfirmDialogTone = "danger" | "warning" | "default";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app confirmation dialog. Replaces window.confirm() — keeps theme,
 * stays inside the React tree, supports busy state for async actions.
 *
 * z-[70] — sits above standard modals (z-50) and dropdowns (z-[55..60]),
 * still below logout-style critical dialogs (z-[100]).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { lang } = useLang();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmTone =
    tone === "danger"
      ? "bg-red-500 hover:bg-red-600 active:bg-red-700 text-white"
      : tone === "warning"
        ? "bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white"
        : "bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white";

  const accentBox =
    tone === "danger"
      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
        : "bg-brand-500/10 text-brand-600 dark:text-brand-400 border-brand-500/30";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-in fade-in duration-100"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-2xl max-w-sm w-full max-h-[92dvh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3 mb-3">
          {tone !== "default" && (
            <div className={`shrink-0 h-9 w-9 rounded-xl border ${accentBox} flex items-center justify-center`}>
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 id="confirm-dialog-title" className="text-[15px] font-bold text-slate-900 dark:text-white">
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">{description}</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-[13px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors disabled:opacity-50"
          >
            {cancelLabel ?? t("common.cancel", lang)}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-2.5 rounded-xl text-[13px] font-semibold transition-colors disabled:opacity-50 ${confirmTone}`}
          >
            {busy ? "…" : (confirmLabel ?? t("common.confirm", lang))}
          </button>
        </div>
      </div>
    </div>
  );
}
