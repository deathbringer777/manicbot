"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, Tag, Users, AlertTriangle, Power } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { PluginIcon } from "~/components/plugins/PluginIcon";
import { InstallConfirmModal } from "~/components/plugins/InstallConfirmModal";

export default function PluginDetailClient() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const { lang } = useLang();
  const [modalOpen, setModalOpen] = useState(false);

  const catalogQ = api.plugins.listCatalog.useQuery({ lang });
  const card = (catalogQ.data ?? []).find((c) => c.slug === slug);

  const utils = api.useUtils();
  const uninstallMut = api.plugins.uninstall.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.uninstall.success", lang));
      utils.plugins.listCatalog.invalidate();
      utils.plugins.getInstalled.invalidate();
    },
    onError: (err) => toast.error(t("plugins.install.error", lang), err.message),
  });

  if (catalogQ.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (!card) {
    return (
      <div className="px-4 sm:px-6 pt-8">
        <Link href="/plugins" className="text-sm text-brand-500 hover:underline inline-flex items-center gap-1.5">
          <ArrowLeft size={14} /> {t("plugins.detail.back", lang)}
        </Link>
        <p className="mt-8 text-slate-500">404</p>
      </div>
    );
  }

  const locked = card.lock.kind !== "none";

  return (
    <div className="min-h-0 flex flex-col max-w-4xl mx-auto w-full px-4 sm:px-6 pt-5 pb-10" data-testid="plugin-detail">
      <Link
        href="/plugins"
        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 inline-flex items-center gap-1.5 self-start"
      >
        <ArrowLeft size={14} /> {t("plugins.detail.back", lang)}
      </Link>

      <header className="mt-4 flex items-start gap-4 flex-wrap">
        <PluginIcon name={card.iconName} tint={card.iconTint} size={32} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {card.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{card.tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          {card.installed ? (
            <button
              type="button"
              disabled={!card.installationId || uninstallMut.isPending}
              onClick={() => {
                if (!card.installationId) return;
                if (!confirm(t("plugins.uninstall.confirm", lang))) return;
                uninstallMut.mutate({ installationId: card.installationId });
              }}
              className="px-3 py-1.5 text-xs rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 inline-flex items-center gap-1.5"
              data-testid="plugin-detail-uninstall"
            >
              <Power size={12} /> {t("plugins.settings.uninstall", lang)}
            </button>
          ) : (
            <button
              type="button"
              disabled={locked}
              onClick={() => setModalOpen(true)}
              data-testid="plugin-detail-install"
              className="px-3 py-1.5 text-xs rounded-xl bg-brand-500 text-white border border-brand-600 hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <CheckCircle2 size={12} /> {t("plugins.card.install", lang)}
            </button>
          )}
        </div>
      </header>

      {locked && (
        <div
          data-testid="plugin-detail-lock-banner"
          className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-sm inline-flex items-center gap-2"
        >
          <AlertTriangle size={14} />
          <span>
            {card.lock.kind === "coming_soon" && t("plugins.lock.comingSoon", lang)}
            {card.lock.kind === "role_mismatch" && t("plugins.lock.roleMismatch", lang)}
            {card.lock.kind === "platform_only" && t("plugins.lock.platformOnly", lang)}
            {card.lock.kind === "plan" && `${t("plugins.lock.plan", lang)}: ${card.lock.required.toUpperCase()}`}
          </span>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("plugins.detail.description", lang)}
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
          {card.description}
        </p>
      </section>

      <section className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-slate-900/50">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 inline-flex items-center gap-1"><Tag size={12} /> {t("plugins.detail.category", lang)}</div>
          <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">{t(`plugins.cat.${card.category}` as never, lang)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-slate-900/50">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            {t("plugins.detail.billingBlock", lang)}
          </div>
          <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">{card.billingLabel}</div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-slate-900/50">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 inline-flex items-center gap-1"><Users size={12} /> {t("plugins.detail.availableFor", lang)}</div>
          <div className="mt-1 text-xs text-slate-700 dark:text-slate-200">
            {/* availableFor rendering is computed server-side via listCatalog.lock; fallback to all */}
            —
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("plugins.detail.keywords", lang)}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.keywords.map((kw) => (
            <span
              key={kw}
              className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10"
            >
              {kw}
            </span>
          ))}
        </div>
      </section>

      <InstallConfirmModal
        card={card}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
