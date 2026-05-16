"use client";

/**
 * ClientsTab — Salon-dashboard "Клиенты" tab (0062 overhaul).
 *
 * Search + filters + paginated list. Row click opens ClientDetailModal.
 * Header buttons: Import / Export. The "+ Add client" action lives on the
 * floating FAB (QuickAddFab in mode="client"), wired by SalonDashboard.
 *
 * Search FTS-backed via `clients.list`. Filter chips are additive. Sort:
 * recent (default) / name / visits. Pagination is offset-based with
 * "Load more" — the typical tenant has dozens to low hundreds of clients,
 * so virtualization isn't worth the complexity yet.
 */

import { useState, useMemo, useEffect } from "react";
import { Loader2, Search, Upload, Download, Users, X } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionHeader } from "~/components/dashboard-ui";
import { ClientRow, type ClientRowData } from "./clients/ClientRow";
import { ClientDetailModal } from "./clients/ClientDetailModal";
import { ImportClientsModal } from "./clients/ImportClientsModal";

const PAGE_SIZE = 50;

type FilterKey = "hasPhone" | "hasEmail" | "hasTg" | "hasIg" | "blocked";

interface Props {
  tenantId: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ClientsTab({ tenantId }: Props) {
  const { lang } = useLang();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    hasPhone: false,
    hasEmail: false,
    hasTg: false,
    hasIg: false,
    blocked: false,
  });
  const [sort, setSort] = useState<"recent" | "name" | "visits">("recent");
  const [offset, setOffset] = useState(0);
  const [openChat, setOpenChat] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const debouncedSearch = useDebounced(search, 300);

  // Reset offset when search/filter/sort changes — otherwise users see
  // a confusing "load more" on a list that just changed shape.
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, filters, sort]);

  const activeFilters = useMemo(() => {
    const f: any = {};
    if (filters.hasPhone) f.hasPhone = true;
    if (filters.hasEmail) f.hasEmail = true;
    if (filters.hasTg) f.hasTg = true;
    if (filters.hasIg) f.hasIg = true;
    if (filters.blocked) f.blocked = true;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [filters]);

  const utils = api.useUtils();

  const list = api.clients.list.useQuery({
    tenantId,
    search: debouncedSearch.trim() || undefined,
    filters: activeFilters,
    sort,
    limit: PAGE_SIZE,
    offset,
  });

  const [isExporting, setIsExporting] = useState(false);
  async function runExport() {
    setIsExporting(true);
    try {
      // exportCsv is a `.query()` (no side-effects on the server beyond a
      // SELECT), so we call it imperatively via the tRPC utils proxy
      // instead of wiring up a fake `useQuery({ enabled: false }) + refetch`.
      const r = await utils.clients.exportCsv.fetch({ tenantId, filters: activeFilters });
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  const rows = (list.data?.rows ?? []) as ClientRowData[];
  const total = list.data?.total ?? 0;
  const hasMore = list.data?.nextOffset != null;

  return (
    <div className="space-y-3" data-testid="clients-tab">
      <SectionHeader title={`${t("clients.title", lang)} · ${total}`} />

      {/* Search + Import/Export bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("clients.search.placeholder", lang)}
            data-testid="clients-search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 outline-none transition focus:border-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            data-testid="clients-import"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
          >
            <Upload className="h-3 w-3" /> {t("clients.action.import", lang)}
          </button>
          <button
            type="button"
            onClick={runExport}
            disabled={isExporting}
            data-testid="clients-export"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
          >
            <Download className="h-3 w-3" />
            {isExporting ? "…" : t("clients.action.export", lang)}
          </button>
        </div>
      </div>

      {/* Filter chips + sort selector */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(["hasPhone", "hasEmail", "hasTg", "hasIg", "blocked"] as const).map((key) => (
          <FilterChip
            key={key}
            active={filters[key]}
            label={t(`clients.filter.${key}` as any, lang)}
            onToggle={() =>
              setFilters((f) => ({ ...f, [key]: !f[key] }))
            }
            testId={`clients-filter-${key}`}
          />
        ))}

        <div className="ml-auto inline-flex items-center gap-1 text-xs">
          {(["recent", "name", "visits"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`rounded-md px-2 py-1 transition ${
                sort === s
                  ? "bg-brand-500/15 text-brand-400"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              {t(`clients.sort.${s}` as any, lang)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {list.isLoading && <Loader2 className="mx-auto animate-spin text-brand-400" />}
      {list.isError && (
        <div className="glass-card rounded-2xl p-6 text-center">
          <p className="text-red-400">{t("common.errorLoading", lang)}</p>
        </div>
      )}
      {list.data && rows.length === 0 && (
        <EmptyState
          icon={Users}
          title={t("salon.noClients", lang)}
          description={t("clients.empty", lang)}
        />
      )}
      <div className="space-y-2">
        {rows.map((c) => (
          <ClientRow
            key={c.chatId}
            c={c}
            onClick={() => setOpenChat(c.chatId)}
          />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={() => setOffset((o) => o + PAGE_SIZE)}
          className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5"
          data-testid="clients-load-more"
        >
          {t("clients.action.loadMore", lang)}
        </button>
      )}

      {openChat != null && (
        <ClientDetailModal
          tenantId={tenantId}
          chatId={openChat}
          onClose={() => setOpenChat(null)}
        />
      )}

      {importOpen && (
        <ImportClientsModal
          tenantId={tenantId}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  onToggle,
  testId,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={testId}
      data-active={active ? "1" : "0"}
      className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
          : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}
