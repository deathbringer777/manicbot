"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Puzzle, Sparkles, Search } from "lucide-react";
import { EmptyState } from "~/components/ui/EmptyState";
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
      <header className="relative px-4 sm:px-6 pt-5 sm:pt-8 pb-5 overflow-hidden">
        <div className="pointer-events-none absolute -top-20 -right-20 h-60 w-60 rounded-full bg-brand-500/[0.10] blur-[100px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 -left-16 h-60 w-60 rounded-full bg-purple-500/[0.08] blur-[100px]" aria-hidden />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500 dark:text-brand-400 mb-2">
              <Sparkles size={11} /> Marketplace
            </div>
            <h1
              data-testid="plugins-title"
              className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight inline-flex items-center gap-3"
            >
              <Puzzle size={26} className="text-brand-500" />
              {t("plugins.title", lang)}
            </h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
              {t("plugins.subtitle", lang)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-testid="plugins-count">
            <div className="px-3 py-2 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.02] backdrop-blur">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">{t("plugins.catalog.countAll", lang)}</div>
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{cards.length}</div>
            </div>
            <div className="px-3 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
              <div className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">{t("plugins.filters.installed", lang)}</div>
              <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">{totalInstalled}</div>
            </div>
            {role === "system_admin" && (
              <button
                type="button"
                data-testid="plugins-admin-install-all"
                onClick={() => installAllMut.mutate()}
                disabled={installAllMut.isPending}
                className="text-[11px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300 border border-brand-500/30 hover:bg-brand-500/20 disabled:opacity-40 font-medium"
              >
                <Sparkles size={12} />
                {t("plugins.admin.installAll", lang)}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6">
        <PluginFilters value={filter} onChange={setFilter} />
      </div>

      <main className="px-4 sm:px-6 pb-10">
        {catalogQ.isLoading ? (
          <div
            data-testid="plugins-skeleton"
            className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-[#e5e7eb] dark:border-white/[0.06] bg-white dark:bg-slate-900/60 p-5 min-h-[200px]"
              >
                <div className="h-10 w-10 rounded-xl skeleton-shimmer" />
                <div className="mt-4 h-4 w-3/4 rounded skeleton-shimmer" />
                <div className="mt-2 h-3 w-full rounded skeleton-shimmer" />
                <div className="mt-1.5 h-3 w-5/6 rounded skeleton-shimmer" />
                <div className="mt-5 h-5 w-20 rounded-full skeleton-shimmer" />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div data-testid="plugins-empty">
            <EmptyState
              icon={Search}
              title={t("plugins.catalog.emptyResult", lang)}
              description={lang === "ru" ? "Попробуйте изменить фильтры или поисковый запрос" : lang === "ua" ? "Спробуйте змінити фільтри або пошуковий запит" : "Try adjusting your filters or search query"}
            />
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
