"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Loader2, CheckCircle2, Tag, Users, AlertTriangle, Power,
  Pin, PinOff, Settings as SettingsIcon, ExternalLink, ToggleLeft, ToggleRight,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import dynamic from "next/dynamic";
import { PluginIcon } from "~/components/plugins/PluginIcon";
import { InstallConfirmModal } from "~/components/plugins/InstallConfirmModal";
import { usePinnedPlugins } from "~/lib/plugins/pinnedPlugins";
import { hasRuntime, loadRuntime } from "~/components/plugins/runtimePanels";
import { getPlugin } from "@plugins/index";

const BackgroundRuntimePlaceholder = dynamic(
  () => import("~/components/plugins/runtimes/BackgroundRuntimePlaceholder"),
  { ssr: false, loading: () => null },
);
import type { PluginLang } from "@plugins/types";
import { PLUGIN_LANGS } from "@plugins/types";

const ROLE_LABELS: Record<string, Record<string, string>> = {
  system_admin: { ru: "Админ платформы", ua: "Адмін платформи", en: "Platform admin", pl: "Admin platformy" },
  tenant_owner: { ru: "Владелец салона", ua: "Власник салону", en: "Salon owner", pl: "Właściciel salonu" },
  tenant_manager: { ru: "Менеджер салона", ua: "Менеджер салону", en: "Salon manager", pl: "Menedżer salonu" },
  master: { ru: "Мастер", ua: "Майстер", en: "Master", pl: "Mistrz" },
  support: { ru: "Саппорт", ua: "Саппорт", en: "Support", pl: "Wsparcie" },
  technical_support: { ru: "Тех. саппорт", ua: "Тех. саппорт", en: "Tech support", pl: "Wsparcie tech." },
};

export default function PluginDetailClient() {
  const params = useParams();
  const slug = String(params?.slug ?? "");
  const { lang } = useLang();
  const { role } = useRole();
  const [modalOpen, setModalOpen] = useState(false);
  const { isPinned, toggle: togglePin } = usePinnedPlugins();

  const catalogQ = api.plugins.listCatalog.useQuery({ lang });
  const card = (catalogQ.data ?? []).find((c) => c.slug === slug);
  const plugin = useMemo(() => getPlugin(slug), [slug]);
  const manifest = plugin?.manifest;

  const utils = api.useUtils();
  const uninstallMut = api.plugins.uninstall.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.uninstall.success", lang));
      utils.plugins.listCatalog.invalidate();
      utils.plugins.getInstalled.invalidate();
    },
    onError: (err) => toast.error(t("plugins.install.error", lang), err.message),
  });
  const enableMut = api.plugins.enable.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.settings.enable", lang));
      utils.plugins.listCatalog.invalidate();
      utils.plugins.getInstalled.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const disableMut = api.plugins.disable.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.settings.disable", lang));
      utils.plugins.listCatalog.invalidate();
      utils.plugins.getInstalled.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (catalogQ.isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }
  if (!card || !manifest) {
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
  const pinned = isPinned(slug);
  const pluginLang: PluginLang = (PLUGIN_LANGS as readonly string[]).includes(lang)
    ? (lang as PluginLang)
    : "ru";

  const navContribs = manifest.capabilities.nav ?? [];
  const openUrl: string | null = (() => {
    if (!card.installed || !card.enabled) return null;
    if (manifest.capabilities.settingsPanel) {
      return `/settings?section=${manifest.capabilities.settingsPanel.sectionKey}`;
    }
    // Fallback: first nav contribution that this role can see.
    const hit = navContribs.find((c) => role && c.roles.includes(role as typeof c.roles[number]));
    return hit?.href ?? null;
  })();

  const availableForLabels = manifest.availableForRoles
    .map((r) => ROLE_LABELS[r]?.[lang] ?? r)
    .join(" · ");

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
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {card.name}
            </h1>
            {card.installed && card.enabled && (
              <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                ✓ {t("plugins.card.installed", lang)}
              </span>
            )}
            {card.installed && !card.enabled && (
              <span className="text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 bg-slate-500/15 text-slate-600 dark:text-slate-300 border border-slate-500/30">
                {t("plugins.card.disabled", lang)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{card.tagline}</p>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">v{manifest.version}</p>
        </div>

        {/* Action group */}
        <div className="flex items-center gap-2 flex-wrap">
          {card.installed && card.installationId ? (
            <>
              {openUrl && (
                <Link
                  href={openUrl}
                  data-testid="plugin-detail-open"
                  className="px-3 py-1.5 text-xs rounded-xl bg-brand-500 text-white border border-brand-600 hover:bg-brand-600 inline-flex items-center gap-1.5"
                >
                  <ExternalLink size={12} /> {t("plugins.card.open", lang)}
                </Link>
              )}
              <button
                type="button"
                data-testid="plugin-detail-pin"
                data-pinned={pinned ? "1" : "0"}
                onClick={() => togglePin(slug)}
                className={`px-3 py-1.5 text-xs rounded-xl border inline-flex items-center gap-1.5 transition-colors ${
                  pinned
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 hover:bg-amber-500/25"
                    : "bg-white dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                }`}
              >
                {pinned ? <Pin size={12} fill="currentColor" /> : <PinOff size={12} />}
                {pinned ? t("plugins.unpin", lang) : t("plugins.pin", lang)}
              </button>
              {card.enabled ? (
                <button
                  type="button"
                  data-testid="plugin-detail-disable"
                  disabled={disableMut.isPending}
                  onClick={() => disableMut.mutate({ installationId: card.installationId! })}
                  className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 inline-flex items-center gap-1.5"
                >
                  <ToggleRight size={14} /> {t("plugins.settings.disable", lang)}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="plugin-detail-enable"
                  disabled={enableMut.isPending}
                  onClick={() => enableMut.mutate({ installationId: card.installationId! })}
                  className="px-3 py-1.5 text-xs rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 inline-flex items-center gap-1.5"
                >
                  <ToggleLeft size={14} /> {t("plugins.settings.enable", lang)}
                </button>
              )}
              {manifest.capabilities.settingsPanel && (
                <Link
                  href={`/settings?section=${manifest.capabilities.settingsPanel.sectionKey}`}
                  data-testid="plugin-detail-settings"
                  className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 inline-flex items-center gap-1.5"
                >
                  <SettingsIcon size={12} /> {t("plugins.settings.title", lang)}
                </Link>
              )}
              <button
                type="button"
                disabled={uninstallMut.isPending}
                onClick={() => {
                  if (!confirm(t("plugins.uninstall.confirm", lang))) return;
                  uninstallMut.mutate({ installationId: card.installationId! });
                }}
                className="px-3 py-1.5 text-xs rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 inline-flex items-center gap-1.5"
                data-testid="plugin-detail-uninstall"
              >
                <Power size={12} /> {t("plugins.settings.uninstall", lang)}
              </button>
            </>
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

      {/* Runtime — inline working area for installed+enabled plugins. */}
      {card.installed && card.enabled && card.installationId && (
        (() => {
          const RuntimeComponent = hasRuntime(slug)
            ? loadRuntime(slug)
            : BackgroundRuntimePlaceholder;
          if (!RuntimeComponent) return null;
          return (
            <section className="mt-6" data-testid="plugin-runtime-area">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">
                {manifest.name[pluginLang]}
              </h2>
              <RuntimeComponent installationId={card.installationId} slug={slug} />
            </section>
          );
        })()
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
        <div
          className="rounded-xl border border-slate-200 dark:border-white/10 p-3 bg-white dark:bg-slate-900/50"
          data-testid="plugin-detail-available-for"
        >
          <div className="text-[11px] uppercase tracking-wider text-slate-400 inline-flex items-center gap-1"><Users size={12} /> {t("plugins.detail.availableFor", lang)}</div>
          <div className="mt-1 text-xs text-slate-700 dark:text-slate-200 leading-snug">
            {availableForLabels}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("plugins.detail.keywords", lang)}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {manifest.keywords[pluginLang].map((kw) => (
            <span
              key={kw}
              className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10"
            >
              {kw}
            </span>
          ))}
        </div>
      </section>

      {manifest.permissions.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t("plugins.install.permissions", lang)}
          </h2>
          <ul className="mt-2 space-y-1">
            {manifest.permissions.map((p) => (
              <li
                key={p.key}
                className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2"
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${p.sensitive ? "bg-amber-500" : "bg-emerald-500"}`} />
                <code className="font-mono">{p.key}</code>
                <span className="text-[10px] uppercase tracking-wider text-slate-400">{p.scope}</span>
                {p.sensitive && (
                  <span className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">sensitive</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <InstallConfirmModal
        card={card}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
