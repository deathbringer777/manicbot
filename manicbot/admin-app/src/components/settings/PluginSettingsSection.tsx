"use client";

import { Power, Trash2, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { getPlugin } from "@plugins/index";
import type { PluginLang } from "@plugins/types";
import { PLUGIN_LANGS } from "@plugins/types";
import { loadPluginPanel } from "./pluginPanels";

export function PluginSettingsSection({ slug }: { slug: string }) {
  const { lang } = useLang();
  const plugin = getPlugin(slug);
  const installedQ = api.plugins.getInstalled.useQuery(undefined, {
    staleTime: 30_000,
  });
  const utils = api.useUtils();
  const disableMut = api.plugins.disable.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.settings.disable", lang));
      utils.plugins.getInstalled.invalidate();
      utils.plugins.listCatalog.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const enableMut = api.plugins.enable.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.settings.enable", lang));
      utils.plugins.getInstalled.invalidate();
      utils.plugins.listCatalog.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const uninstallMut = api.plugins.uninstall.useMutation({
    onSuccess: () => {
      toast.success(t("plugins.uninstall.success", lang));
      utils.plugins.getInstalled.invalidate();
      utils.plugins.listCatalog.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (installedQ.isLoading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const installation = (installedQ.data ?? []).find((r) => r.pluginSlug === slug);
  if (!plugin || !installation) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400" data-testid="plugin-settings-missing">
        {t("plugins.catalog.emptyResult", lang)}
      </div>
    );
  }

  const pluginLang: PluginLang = (PLUGIN_LANGS as readonly string[]).includes(lang)
    ? (lang as PluginLang)
    : "ru";
  const panelComponentId = plugin.manifest.capabilities.settingsPanel?.componentId;
  const Panel = panelComponentId ? loadPluginPanel(panelComponentId) : null;

  return (
    <div data-testid="plugin-settings-section" data-slug={slug} className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {plugin.manifest.name[pluginLang]} · {t("plugins.settings.title", lang)}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {plugin.manifest.tagline[pluginLang]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {installation.enabled === 1 ? (
            <button
              type="button"
              disabled={disableMut.isPending}
              onClick={() => disableMut.mutate({ installationId: installation.id })}
              data-testid="plugin-settings-disable"
              className="px-3 py-1.5 text-xs rounded-xl border border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 inline-flex items-center gap-1.5"
            >
              <Power size={12} /> {t("plugins.settings.disable", lang)}
            </button>
          ) : (
            <button
              type="button"
              disabled={enableMut.isPending}
              onClick={() => enableMut.mutate({ installationId: installation.id })}
              data-testid="plugin-settings-enable"
              className="px-3 py-1.5 text-xs rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1.5"
            >
              <Power size={12} /> {t("plugins.settings.enable", lang)}
            </button>
          )}
          <button
            type="button"
            disabled={uninstallMut.isPending}
            onClick={() => {
              if (!confirm(t("plugins.uninstall.confirm", lang))) return;
              uninstallMut.mutate({ installationId: installation.id });
            }}
            data-testid="plugin-settings-uninstall"
            className="px-3 py-1.5 text-xs rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/10 inline-flex items-center gap-1.5"
          >
            <Trash2 size={12} /> {t("plugins.settings.uninstall", lang)}
          </button>
        </div>
      </header>

      {Panel ? (
        <div data-testid="plugin-settings-custom-panel">
          <Panel installationId={installation.id} />
        </div>
      ) : (
        <div
          data-testid="plugin-settings-no-panel"
          className="rounded-xl border border-dashed border-slate-200 dark:border-white/10 p-4 text-sm text-slate-500 dark:text-slate-400"
        >
          {plugin.manifest.description[pluginLang]}
        </div>
      )}
    </div>
  );
}
