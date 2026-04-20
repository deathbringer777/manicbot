"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Puzzle, Loader2, Sparkles } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { toast } from "~/lib/toast";
import { PluginFilters, type FilterValue } from "~/components/plugins/PluginFilters";
import { PluginCard } from "~/components/plugins/PluginCard";
import { buildCatalogIndex } from "~/lib/plugins/clientIndex";

const AUTO_INSTALL_KEY = "manicbot_plugins_admin_autoinstalled";

export default function PluginsCatalogClient() {
  const { lang } = useLang();
  const { role } = useRole();
  const [filter, setFilter] = useState<FilterValue>({
    q: "",
    category: null,
    billing: null,
    installedOnly: false,
  });

  const catalogQ = api.plugins.listCatalog.useQuery({ lang });
  const cards = catalogQ.data ?? [];
  const utils = api.useUtils();

  const installAllMut = api.plugins.adminInstallAll.useMutation({
    onSuccess: (data) => {
      if (data.inserted > 0) {
        toast.success(t("plugins.admin.installAll", lang), `+${data.inserted}`);
      }
      utils.plugins.listCatalog.invalidate();
      utils.plugins.getInstalled.invalidate();
    },
  });

  // Auto-install all plugins for admin on first visit (one-shot, idempotent on backend).
  const autoRan = useRef(false);
  useEffect(() => {
    if (role !== "system_admin" || autoRan.current) return;
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(AUTO_INSTALL_KEY) === "1") {
        return;
      }
    } catch { /* noop */ }
    autoRan.current = true;
    installAllMut.mutate(undefined, {
      onSettled: () => {
        try { window.localStorage.setItem(AUTO_INSTALL_KEY, "1"); } catch { /* noop */ }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const index = useMemo(() => buildCatalogIndex(cards), [cards]);
  const visible = useMemo(() => {
    let list = filter.q ? index.search(filter.q) : cards;
    if (filter.category) list = list.filter((c) => c.category === filter.category);
    if (filter.billing) list = list.filter((c) => c.billingModel === filter.billing);
    if (filter.installedOnly) list = list.filter((c) => c.installed);
    return list;
  }, [cards, index, filter]);

  const totalInstalled = cards.filter((c) => c.installed).length;

  return (
    <div className="min-h-0 flex flex-col">
      <header className="px-4 sm:px-6 pt-5 sm:pt-8 pb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            data-testid="plugins-title"
            className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"
          >
            <Puzzle size={22} className="text-brand-500" />
            {t("plugins.title", lang)}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
            {t("plugins.subtitle", lang)}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs text-slate-500 dark:text-slate-400" data-testid="plugins-count">
            {t("plugins.catalog.countAll", lang)}: {cards.length} · {t("plugins.filters.installed", lang)}: {totalInstalled}
          </div>
          {role === "system_admin" && (
            <button
              type="button"
              data-testid="plugins-admin-install-all"
              onClick={() => installAllMut.mutate()}
              disabled={installAllMut.isPending}
              className="text-[11px] inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-300 border border-brand-500/30 hover:bg-brand-500/20 disabled:opacity-40"
            >
              <Sparkles size={12} />
              {t("plugins.admin.installAll", lang)}
            </button>
          )}
        </div>
      </header>

      <div className="px-4 sm:px-6">
        <PluginFilters value={filter} onChange={setFilter} />
      </div>

      <main className="px-4 sm:px-6 pb-10">
        {catalogQ.isLoading ? (
          <div className="h-64 flex items-center justify-center text-slate-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div
            data-testid="plugins-empty"
            className="mt-8 h-64 flex items-center justify-center text-sm text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-white/10"
          >
            {t("plugins.catalog.emptyResult", lang)}
          </div>
        ) : (
          <div
            data-testid="plugins-grid"
            className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
          >
            {visible.map((card) => (
              <PluginCard key={card.slug} card={card} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
