"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, MessageSquare, Search } from "lucide-react";
import { api } from "~/trpc/react";
import { Select } from "~/components/ui/Select";
import { ThreadView } from "./ThreadView";
import { useLang } from "~/components/LangContext";
import { formatRelativeTime, t } from "~/lib/i18n";

/**
 * God-Mode cross-tenant client inbox. The consolidated replacement for the
 * retired `/conversations` surface — but, unlike the old shallow metadata list,
 * this opens the real `client_conv` thread via `<ThreadView>` so a sysadmin can
 * actually read and reply (support escalation) across all salons.
 *
 * Data comes from `messenger.listClientConvAdmin` (systemAdminProcedure). Each
 * row carries its own `tenantId`, which we pass straight into `ThreadView` so
 * the `getThread` tenant-pin keeps cross-tenant reads scoped.
 */
export function GodClientInbox() {
  const { lang } = useLang();
  const [tenantFilter, setTenantFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<{ threadId: string; tenantId: string } | null>(null);

  const tenants = api.tenants.getAll.useQuery();
  const tenantOptions = useMemo(() => {
    const rows = tenants.data ?? [];
    return [
      { value: "", label: t("conv.filter.allSalons", lang) },
      ...rows.map((r: { id: string; name: string | null }) => ({
        value: r.id,
        label: r.name ?? r.id,
      })),
    ];
  }, [tenants.data, lang]);

  const listQ = api.messenger.listClientConvAdmin.useQuery(
    {
      tenantId: tenantFilter || undefined,
      archived: showArchived,
      search: search.trim() || undefined,
      limit: 50,
    },
    { refetchInterval: 10000, refetchOnWindowFocus: true },
  );
  const items = listQ.data?.items ?? [];

  return (
    <div
      className="grid h-full grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid-cols-[340px_minmax(0,1fr)] dark:border-slate-800 dark:bg-slate-900"
      data-testid="god-client-inbox"
    >
      {/* Left: filters + list */}
      <div className={selected ? "hidden md:flex md:flex-col" : "flex flex-col"}>
        <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("messenger.god.searchClients", lang)}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={tenantFilter}
              onChange={setTenantFilter}
              options={tenantOptions}
              placeholder={t("conv.filter.allSalons", lang)}
              testIdPrefix="god-client-tenant"
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                showArchived
                  ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                  : "border-slate-200 text-slate-500 hover:text-slate-700 dark:border-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {showArchived ? t("messenger.god.showOpen", lang) : t("messenger.god.showArchived", lang)}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto" data-testid="god-client-list">
          {listQ.isLoading ? (
            <div className="p-6 text-center text-xs text-slate-500">
              {t("messenger.platform.loading", lang)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                <MessageSquare className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t("messenger.god.empty", lang)}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {t("messenger.god.emptyHint", lang)}
              </p>
            </div>
          ) : (
            items.map((it) => {
              const isSel = selected?.threadId === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelected({ threadId: it.id, tenantId: it.tenantId })}
                  className={`flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 ${
                    isSel ? "bg-brand-500/5 dark:bg-brand-500/10" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {it.tenantName ?? it.tenantId}
                      </div>
                      {it.lastMessageAt && (
                        <div className="shrink-0 text-[10px] text-slate-400">
                          {formatRelativeTime(it.lastMessageAt, lang)}
                        </div>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {it.title || it.lastMessagePreview || t("messenger.platform.previewEmpty", lang)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right: real thread detail (reuses ThreadView) */}
      <div className={selected ? "block" : "hidden md:block"}>
        {selected ? (
          <div className="relative h-full">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="absolute left-2 top-2 z-10 flex h-7 items-center gap-1 rounded-md bg-white/80 px-2 text-xs text-slate-600 backdrop-blur md:hidden dark:bg-slate-900/80 dark:text-slate-300"
            >
              <ArrowLeft className="h-3 w-3" />
              {t("messenger.back", lang)}
            </button>
            <ThreadView tenantId={selected.tenantId} threadId={selected.threadId} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
              <MessageSquare className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t("messenger.selectChat", lang)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
