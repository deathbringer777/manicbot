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
 *
 * Lists (shared with Marketing): a "Listy" chip-rail filters the list to a
 * marketing_segment's members; multi-select + a bulk bar add/remove the
 * picked clients to/from a list. Lists are the SAME entity the Marketing
 * module uses — `marketingTenant.segmentsList` (kind='manual').
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { Loader2, Search, Upload, Download, Users, X, ChevronDown, ListChecks, Plus } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionHeader } from "~/components/dashboard-ui";
import { CreateListModal } from "~/components/marketing/CreateListModal";
import { ClientRow, type ClientRowData } from "./clients/ClientRow";
import { ClientDetailModal } from "./clients/ClientDetailModal";
import { ImportClientsModal } from "./clients/ImportClientsModal";

const PAGE_SIZE = 50;

type FilterKey = "hasPhone" | "hasEmail" | "hasTg" | "hasIg" | "blocked";

interface ListRow {
  id: string;
  name: string;
  kind: string;
  contactCount: number;
}

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

  // Lists state.
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [createListOpen, setCreateListOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 300);

  // Reset offset + clear selection when the result set changes shape —
  // otherwise users see a stale "load more" or a tick on a row they can no
  // longer see.
  useEffect(() => {
    setOffset(0);
    setSelectedIds(new Set());
  }, [debouncedSearch, filters, sort, selectedListId]);

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
    listId: selectedListId ?? undefined,
    limit: PAGE_SIZE,
    offset,
  });

  const listsQ = api.marketingTenant.segmentsList.useQuery({ tenantId });
  const lists = useMemo(
    () => ((listsQ.data ?? []) as ListRow[]).filter((l) => l.kind === "manual"),
    [listsQ.data],
  );

  // Transient confirmation banner (no toast lib in this surface).
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashMsg(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 4000);
  }
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  function refreshAfterMembership() {
    void utils.clients.list.invalidate();
    void utils.marketingTenant.segmentsList.invalidate({ tenantId });
    setSelectedIds(new Set());
  }

  const addToList = api.clients.addToList.useMutation({
    onSuccess: (res) => {
      setAddMenuOpen(false);
      refreshAfterMembership();
      const extra = res.skipped ? ` · ${res.skipped} ${t("clients.lists.skipped", lang)}` : "";
      flashMsg(`${t("clients.lists.added", lang)}: ${res.added}${extra}`);
    },
  });
  const removeFromList = api.clients.removeFromList.useMutation({
    onSuccess: () => {
      refreshAfterMembership();
      flashMsg(t("clients.lists.removed", lang));
    },
  });

  const toggleSelect = (chatId: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });

  const [isExporting, setIsExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Close the export dropdown on outside click — mirrors the `FilterDropdown`
  // pattern used elsewhere in the dashboard.
  useEffect(() => {
    if (!exportMenuOpen) return;
    function handler(e: MouseEvent) {
      if (!exportMenuRef.current?.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    function handler(e: MouseEvent) {
      if (!addMenuRef.current?.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen]);

  async function runExport(format: "manicbot" | "google" | "apple") {
    setExportMenuOpen(false);
    setIsExporting(true);
    try {
      // exportCsv is a `.query()` (no side-effects on the server beyond a
      // SELECT), so we call it imperatively via the tRPC utils proxy
      // instead of wiring up a fake `useQuery({ enabled: false }) + refetch`.
      const r = await utils.clients.exportCsv.fetch({ tenantId, filters: activeFilters, format });
      const blob = new Blob([r.data], { type: r.mime ?? "text/csv;charset=utf-8" });
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
  const selectedCount = selectedIds.size;
  const membershipPending = addToList.isPending || removeFromList.isPending;

  return (
    <div className="space-y-3" data-testid="clients-tab">
      <SectionHeader title={`${t("clients.title", lang)} · ${total}`} />

      {/* Search + Import/Export bar.
          Mobile: search on top, buttons split 50/50 below (flex-1 on
          buttons). Tablet+: everything on one line. Buttons use py-2.5
          to clear 44px touch-target on mobile. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("clients.search.placeholder", lang)}
            data-testid="clients-search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-8 text-sm text-slate-900 outline-none transition focus:border-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            data-testid="clients-import"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200 sm:flex-initial"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span>{t("clients.action.import", lang)}</span>
          </button>
          <div ref={exportMenuRef} className="relative flex-1 sm:flex-initial">
            <button
              type="button"
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={isExporting}
              data-testid="clients-export"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>{isExporting ? "…" : t("clients.action.export", lang)}</span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </button>
            {exportMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900"
              >
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {t("clients.export.menuTitle", lang)}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runExport("manicbot")}
                  data-testid="clients-export-manicbot"
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  {t("clients.export.format.manicbot", lang)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runExport("google")}
                  data-testid="clients-export-google"
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  {t("clients.export.format.google", lang)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runExport("apple")}
                  data-testid="clients-export-apple"
                  className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  {t("clients.export.format.apple", lang)}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lists rail — shared marketing segments (kind='manual'). Single-select
          filter: tap a list to show only its members; tap again or «Все» to
          clear. «+ список» creates a new shared list. */}
      <div
        className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-none"
        data-testid="clients-list-rail"
      >
        <span className="inline-flex shrink-0 items-center gap-1 pr-0.5 text-[11px] font-medium text-slate-400">
          <ListChecks className="h-3.5 w-3.5" />
          {t("clients.lists.label", lang)}
        </span>
        <ListChip
          active={selectedListId === null}
          label={t("clients.lists.all", lang)}
          onClick={() => setSelectedListId(null)}
          testId="clients-list-chip-all"
        />
        {lists.map((l) => (
          <ListChip
            key={l.id}
            active={selectedListId === l.id}
            label={l.name}
            count={l.contactCount}
            onClick={() => setSelectedListId((prev) => (prev === l.id ? null : l.id))}
            testId={`clients-list-chip-${l.id}`}
          />
        ))}
        <button
          type="button"
          onClick={() => setCreateListOpen(true)}
          data-testid="clients-list-new"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-500 transition hover:border-brand-400 hover:bg-slate-50 dark:border-white/15 dark:text-slate-400 dark:hover:bg-white/5"
        >
          <Plus className="h-3 w-3" />
          {t("clients.lists.new", lang)}
        </button>
      </div>

      {/* Filter chips — horizontally scrollable on mobile to avoid wrapping
          into a 3-row tall block. The full-bleed `-mx-1` trims to the
          tab gutter. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-none">
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
      </div>

      {/* Sort selector on its own row, also scrollable when mobile labels
          (e.g. Ukrainian "За візитами") are wider than the viewport. */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-none">
        {(["recent", "name", "visits"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSort(s)}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs transition ${
              sort === s
                ? "bg-brand-500/15 text-brand-400"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5"
            }`}
          >
            {t(`clients.sort.${s}` as any, lang)}
          </button>
        ))}
      </div>

      {flash && (
        <div
          data-testid="clients-flash"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
        >
          {flash}
        </div>
      )}

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
          description={selectedListId ? t("clients.lists.emptyInList", lang) : t("clients.empty", lang)}
        />
      )}
      <div className="space-y-2">
        {rows.map((c) => (
          <ClientRow
            key={c.chatId}
            c={c}
            onClick={() => setOpenChat(c.chatId)}
            selectable
            selected={selectedIds.has(c.chatId)}
            onToggleSelect={() => toggleSelect(c.chatId)}
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

      {/* Bulk action bar — appears once 1+ clients are ticked. Sticky to the
          viewport bottom so it stays reachable while scrolling a long list. */}
      {selectedCount > 0 && (
        <div
          data-testid="clients-bulk-bar"
          className="sticky bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/30 bg-white/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur dark:border-brand-500/30 dark:bg-slate-900/95"
        >
          <span className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {t("clients.lists.selected", lang)} · {selectedCount}
          </span>
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              disabled={membershipPending}
              data-testid="clients-bulk-add"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("clients.lists.addTo", lang)}
              <ChevronDown className="h-3 w-3 opacity-80" />
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900"
              >
                {lists.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-slate-400">
                    {t("clients.lists.label", lang)} —
                  </p>
                )}
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      addToList.mutate({ tenantId, chatIds: [...selectedIds], listId: l.id })
                    }
                    data-testid={`clients-bulk-add-${l.id}`}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-slate-400">{l.contactCount}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddMenuOpen(false);
                    setCreateListOpen(true);
                  }}
                  className="mt-1 flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-brand-500 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("clients.lists.new", lang)}
                </button>
              </div>
            )}
          </div>
          {selectedListId && (
            <button
              type="button"
              onClick={() =>
                removeFromList.mutate({ tenantId, chatIds: [...selectedIds], listId: selectedListId })
              }
              disabled={membershipPending}
              data-testid="clients-bulk-remove"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              {t("clients.lists.removeFrom", lang)}
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            data-testid="clients-bulk-clear"
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <X className="h-3.5 w-3.5" />
            {t("clients.lists.clear", lang)}
          </button>
        </div>
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

      {createListOpen && (
        <CreateListModal
          tenantId={tenantId}
          lang={lang as Lang}
          onClose={() => setCreateListOpen(false)}
          onCreated={(id) => {
            void utils.marketingTenant.segmentsList.invalidate({ tenantId });
            setSelectedListId(id);
          }}
        />
      )}
    </div>
  );
}

function ListChip({
  active,
  label,
  count,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "1" : "0"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium transition ${
        active
          ? "border border-brand-500/30 bg-brand-500/20 text-brand-400"
          : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
      }`}
    >
      <span className="max-w-[140px] truncate">{label}</span>
      {typeof count === "number" && (
        <span className={`tabular-nums ${active ? "text-brand-400/80" : "text-slate-400"}`}>· {count}</span>
      )}
    </button>
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
