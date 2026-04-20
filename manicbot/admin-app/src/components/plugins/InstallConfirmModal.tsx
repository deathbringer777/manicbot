"use client";

import { useState } from "react";
import { X, Shield, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { api } from "~/trpc/react";
import type { CatalogCard } from "@plugins/types";

export function InstallConfirmModal({
  card,
  open,
  onClose,
  onInstalled,
}: {
  card: CatalogCard;
  open: boolean;
  onClose: () => void;
  onInstalled?: () => void;
}) {
  const { lang } = useLang();
  const utils = api.useUtils();
  const [submitting, setSubmitting] = useState(false);
  const installMut = api.plugins.install.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.install.success", lang), card.name);
      utils.plugins.listCatalog.invalidate();
      utils.plugins.getInstalled.invalidate();
      onInstalled?.();
      onClose();
    },
    onError: (err) => {
      toast.error(t("plugins.install.error", lang), err.message);
    },
    onSettled: () => setSubmitting(false),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plugin-install-title"
      data-testid="install-confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl p-5 sm:p-6">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("plugins.install.cancel", lang)}
          className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
        >
          <X size={18} />
        </button>
        <h2 id="plugin-install-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t("plugins.install.title", lang)}: {card.name}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{card.tagline}</p>

        {card.lock.kind === "plan" && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm">
            <AlertTriangle size={16} className="mt-0.5" />
            <span>{t("plugins.lock.plan", lang)}: {card.lock.required.toUpperCase()}</span>
          </div>
        )}

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1.5">
            <Shield size={14} /> {t("plugins.install.permissions", lang)}
          </h3>
          <ul className="mt-2 space-y-1.5" data-testid="install-modal-permissions">
            <li className="text-xs text-slate-500 dark:text-slate-400 italic">
              {/* Placeholder until plugin manifest surfaces permissions to client. */}
              —
            </li>
          </ul>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-white/10">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {card.billingLabel}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              {t("plugins.install.cancel", lang)}
            </button>
            <button
              type="button"
              disabled={submitting || installMut.isPending || card.lock.kind !== "none"}
              onClick={() => {
                setSubmitting(true);
                installMut.mutate({ slug: card.slug });
              }}
              data-testid="install-modal-confirm"
              className="px-3 py-1.5 text-xs rounded-xl bg-brand-500 text-white border border-brand-600 hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {submitting || installMut.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CheckCircle2 size={12} />
              )}
              {t("plugins.install.confirm", lang)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
