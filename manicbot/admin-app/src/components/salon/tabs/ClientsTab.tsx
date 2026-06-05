"use client";

/**
 * ClientsTab — Salon-dashboard "Клиенты" tab (0062 overhaul, 0109 bulk actions).
 *
 * Search + filters + paginated list. Row click opens ClientDetailModal.
 * Header buttons: Import / Export. The "+ Add client" action lives on the
 * floating FAB (QuickAddFab in mode="client"), wired by SalonDashboard.
 *
 * Search FTS-backed via `clients.list`. Filters live behind a compact
 * "Filters ▾" dropdown (MultiSelectFilterDropdown) with an active-count badge.
 * Sort: recent (default) / name / visits. Pagination is offset-based with
 * "Load more" — the typical tenant has dozens to low hundreds of clients,
 * so virtualization isn't worth the complexity yet.
 *
 * Selection (Gmail-style): per-row checkboxes + a master "select all" header.
 * When the whole loaded page is ticked and more rows match, a banner offers
 * "select all N matching" — fetched server-side via `clients.listMatchingIds`
 * so the selection spans the entire filtered set, not just the page. The
 * sticky bottom bar then runs bulk actions on `[...selectedIds]`: add/remove
 * to a list, new list from selection, block/unblock, delete (with a danger
 * confirm), export selected, and "create broadcast" (creates a list from the
 * selection and hands off to the Marketing campaign creator). All bulk
 * mutations chunk into ≤500-id batches (the server cap).
 *
 * Lists (shared with Marketing): a "Listy" chip-rail filters the list to a
 * marketing_segment's members. Lists are the SAME entity the Marketing module
 * uses — `marketingTenant.segmentsList` (kind='manual').
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Search, Upload, Download, Users, X, ChevronDown, ListChecks,
  Plus, Check, Minus, MoreHorizontal, Trash2, Ban, ShieldCheck, Megaphone,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { EmptyState } from "~/components/ui/EmptyState";
import { SectionHeader } from "~/components/dashboard-ui";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { MultiSelectFilterDropdown } from "~/components/ui/MultiSelectFilterDropdown";
import { CreateListModal } from "~/components/marketing/CreateListModal";
import { ClientRow, type ClientRowData } from "./clients/ClientRow";
import { ClientDetailModal } from "./clients/ClientDetailModal";
import { ImportClientsModal } from "./clients/ImportClientsModal";

const PAGE_SIZE = 50;
/** Server caps every bulk mutation at 500 ids/call — chunk larger selections. */
const BULK_CHUNK = 500;

type FilterKey = "hasPhone" | "hasEmail" | "hasTg" | "hasIg" | "blocked";
const FILTER_KEYS: FilterKey[] = ["hasPhone", "hasEmail", "hasTg", "hasIg", "blocked"];
const EMPTY_FILTERS: Record<FilterKey, boolean> = {
  hasPhone: false, hasEmail: false, hasTg: false, hasIg: false, blocked: false,
};

/** Intent for the CreateListModal — drives what happens after the list is made. */
type ListIntent = "filter" | "selection" | "broadcast";

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

/** Run `fn` over `ids` in fixed-size batches, sequentially. */
async function inChunks(ids: number[], size: number, fn: (batch: number[]) => Promise<void>) {
  for (let i = 0; i < ids.length; i += size) {
    await fn(ids.slice(i, i + size));
  }
}

export function ClientsTab({ tenantId }: Props) {
  const { lang } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({ ...EMPTY_FILTERS });
  const [sort, setSort] = useState<"recent" | "name" | "visits">("recent");
  const [offset, setOffset] = useState(0);
  const [openChat, setOpenChat] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Lists + selection state.
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [listIntent, setListIntent] = useState<ListIntent>("filter");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "block">(null);
  const [acting, setActing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 300);

  // Reset offset + clear selection when the result set changes shape — otherwise
  // users see a stale "load more" or a tick on a row they can no longer see, or
  // a "select all matching" flag that refers to the previous filter.
  useEffect(() => {
    setOffset(0);
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, [debouncedSearch, filters, sort, selectedListId]);

  const activeFilters = useMemo(() => {
    const f: Record<string, boolean> = {};
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

  // After any membership / bulk write: refetch the list + list counts and drop
  // the selection (a removed/deleted row must not stay ticked).
  function refreshAfterBulk() {
    void utils.clients.list.invalidate();
    void utils.marketingTenant.segmentsList.invalidate({ tenantId });
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }

  const addToListMut = api.clients.addToList.useMutation();
  const removeFromListMut = api.clients.removeFromList.useMutation();
  const bulkDeleteMut = api.clients.bulkDelete.useMutation();
  const bulkBlockMut = api.clients.bulkSetGlobalBlock.useMutation();
  const bulkBusy =
    acting || addToListMut.isPending || removeFromListMut.isPending ||
    bulkDeleteMut.isPending || bulkBlockMut.isPending;

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
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Close each dropdown on outside click — mirrors the `FilterDropdown` pattern.
  useOutsideClose(exportMenuRef, exportMenuOpen, () => setExportMenuOpen(false));
  useOutsideClose(addMenuRef, addMenuOpen, () => setAddMenuOpen(false));
  useOutsideClose(moreMenuRef, moreMenuOpen, () => setMoreMenuOpen(false));

  const rows = (list.data?.rows ?? []) as ClientRowData[];
  const total = list.data?.total ?? 0;
  const hasMore = list.data?.nextOffset != null;
  const selectedCount = selectedIds.size;

  const loadedIds = useMemo(() => rows.map((r) => r.chatId), [rows]);
  const allLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selectedIds.has(id));
  const someLoadedSelected = !allLoadedSelected && loadedIds.some((id) => selectedIds.has(id));
  const showSelectAllBanner = allLoadedSelected && !selectAllMatching && total > selectedCount;

  function toggleSelectAllLoaded() {
    if (allLoadedSelected) {
      setSelectedIds(new Set());
      setSelectAllMatching(false);
    } else {
      setSelectedIds(new Set(loadedIds));
    }
  }

  async function selectAllMatchingNow() {
    const r = await utils.clients.listMatchingIds.fetch({
      tenantId,
      search: debouncedSearch.trim() || undefined,
      filters: activeFilters,
      listId: selectedListId ?? undefined,
    });
    setSelectedIds(new Set(r.chatIds));
    setSelectAllMatching(true);
    if (r.capped) {
      flashMsg(t("clients.bulk.selectAllCapped", lang).replace("{count}", String(r.chatIds.length)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }

  // ── Bulk orchestration (each chunks into ≤500-id batches) ───────────────────
  async function runAddToList(listId: string) {
    const ids = [...selectedIds];
    setActing(true);
    let added = 0;
    let skipped = 0;
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        const r = await addToListMut.mutateAsync({ tenantId, chatIds: batch, listId });
        added += r.added;
        skipped += r.skipped;
      });
      setAddMenuOpen(false);
      const extra = skipped ? ` · ${skipped} ${t("clients.lists.skipped", lang)}` : "";
      flashMsg(`${t("clients.lists.added", lang)}: ${added}${extra}`);
      refreshAfterBulk();
    } finally {
      setActing(false);
    }
  }

  async function runRemoveFromList() {
    if (!selectedListId) return;
    const ids = [...selectedIds];
    setActing(true);
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        await removeFromListMut.mutateAsync({ tenantId, chatIds: batch, listId: selectedListId });
      });
      flashMsg(t("clients.lists.removed", lang));
      refreshAfterBulk();
    } finally {
      setActing(false);
    }
  }

  async function runBulkDelete() {
    const ids = [...selectedIds];
    setActing(true);
    let deleted = 0;
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        const r = await bulkDeleteMut.mutateAsync({ tenantId, chatIds: batch });
        deleted += r.deleted;
      });
      flashMsg(t("clients.bulk.deleted", lang).replace("{count}", String(deleted)));
      refreshAfterBulk();
    } finally {
      setActing(false);
    }
  }

  async function runBulkBlock(blocked: boolean) {
    setMoreMenuOpen(false);
    const ids = [...selectedIds];
    setActing(true);
    let updated = 0;
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        const r = await bulkBlockMut.mutateAsync({ tenantId, chatIds: batch, blocked });
        updated += r.updated;
      });
      flashMsg(
        t(blocked ? "clients.bulk.blocked" : "clients.bulk.unblocked", lang)
          .replace("{count}", String(updated)),
      );
      refreshAfterBulk();
    } finally {
      setActing(false);
    }
  }

  async function runExport(format: "manicbot" | "google" | "apple", chatIds?: number[]) {
    setExportMenuOpen(false);
    setMoreMenuOpen(false);
    setIsExporting(true);
    try {
      // exportCsv is a `.query()` (a plain SELECT), so call it imperatively via
      // the utils proxy. `chatIds` (export-selected) overrides `filters`.
      const r = await utils.clients.exportCsv.fetch({
        tenantId,
        filters: chatIds ? undefined : activeFilters,
        chatIds,
        format,
      });
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

  // "New list from selection" / "Create broadcast": open the create-list modal
  // tagged with an intent; the post-create work happens in `onCreated`.
  function openCreateList(intent: ListIntent) {
    setListIntent(intent);
    setCreateListOpen(true);
    setMoreMenuOpen(false);
  }

  function handleListCreated(id: string) {
    void utils.marketingTenant.segmentsList.invalidate({ tenantId });
    const intent = listIntent;
    setListIntent("filter");
    if (intent === "filter") {
      setSelectedListId(id);
      return;
    }
    // selection / broadcast: push the current selection into the new list.
    const ids = [...selectedIds];
    void (async () => {
      setActing(true);
      try {
        await inChunks(ids, BULK_CHUNK, async (batch) => {
          await addToListMut.mutateAsync({ tenantId, chatIds: batch, listId: id });
        });
        if (intent === "broadcast") {
          router.push(`/marketing/campaigns?segmentId=${encodeURIComponent(id)}`);
          return;
        }
        setSelectedListId(id);
        flashMsg(`${t("clients.lists.added", lang)}: ${ids.length}`);
        refreshAfterBulk();
      } finally {
        setActing(false);
      }
    })();
  }

  return (
    <div className="space-y-3" data-testid="clients-tab">
      <SectionHeader title={`${t("clients.title", lang)} · ${total}`} />

      {/* Search + Import/Export bar. */}
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
                <button type="button" role="menuitem" onClick={() => runExport("manicbot")} data-testid="clients-export-manicbot" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5">
                  {t("clients.export.format.manicbot", lang)}
                </button>
                <button type="button" role="menuitem" onClick={() => runExport("google")} data-testid="clients-export-google" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5">
                  {t("clients.export.format.google", lang)}
                </button>
                <button type="button" role="menuitem" onClick={() => runExport("apple")} data-testid="clients-export-apple" className="block w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5">
                  {t("clients.export.format.apple", lang)}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lists rail — shared marketing segments (kind='manual'). */}
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
          onClick={() => openCreateList("filter")}
          data-testid="clients-list-new"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1 text-[11px] font-medium text-slate-500 transition hover:border-brand-400 hover:bg-slate-50 dark:border-white/15 dark:text-slate-400 dark:hover:bg-white/5"
        >
          <Plus className="h-3 w-3" />
          {t("clients.lists.new", lang)}
        </button>
      </div>

      {/* Compact toolbar: Filters dropdown + sort — replaces the old chip row. */}
      <div className="flex items-center gap-2">
        <MultiSelectFilterDropdown
          label={t("clients.filter.button", lang)}
          options={FILTER_KEYS.map((k) => ({
            value: k,
            label: t(`clients.filter.${k}` as Parameters<typeof t>[0], lang),
            testId: `clients-filter-${k}`,
          }))}
          selected={filters}
          onToggle={(k) => setFilters((f) => ({ ...f, [k]: !f[k] }))}
          onReset={() => setFilters({ ...EMPTY_FILTERS })}
          resetLabel={t("clients.filter.reset", lang)}
          triggerTestId="clients-filter-trigger"
          className="shrink-0"
        />
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
              {t(`clients.sort.${s}` as Parameters<typeof t>[0], lang)}
            </button>
          ))}
        </div>
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

      {/* Master "select all" header — aligned over the per-row checkbox gutter. */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 px-1" data-testid="clients-select-all-row">
          <button
            type="button"
            role="checkbox"
            aria-checked={allLoadedSelected ? true : someLoadedSelected ? "mixed" : false}
            aria-label={t("clients.bulk.selectAll", lang)}
            data-testid="clients-select-all"
            onClick={toggleSelectAllLoaded}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
              allLoadedSelected || someLoadedSelected
                ? "border-brand-500 bg-brand-500 text-white"
                : "border-slate-300 bg-white hover:border-brand-400 dark:border-white/20 dark:bg-white/[0.04]"
            }`}
          >
            {allLoadedSelected ? (
              <Check className="h-3 w-3" strokeWidth={3} />
            ) : someLoadedSelected ? (
              <Minus className="h-3 w-3" strokeWidth={3} />
            ) : null}
          </button>
          <span className="text-[11px] font-medium text-slate-500">
            {selectedCount > 0
              ? `${t("clients.lists.selected", lang)} · ${selectedCount}`
              : t("clients.bulk.selectAll", lang)}
          </span>
        </div>
      )}

      {/* "Select all N matching" banner (Gmail-style). */}
      {(showSelectAllBanner || selectAllMatching) && (
        <div
          data-testid="clients-select-all-banner"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/5 px-3 py-1.5 text-[11px] text-slate-600 dark:text-slate-300"
        >
          {selectAllMatching ? (
            <>
              <span>{t("clients.bulk.allSelected", lang).replace("{total}", String(total))}</span>
              <button
                type="button"
                onClick={clearSelection}
                data-testid="clients-clear-all-matching"
                className="font-semibold text-brand-500 hover:underline"
              >
                {t("clients.lists.clear", lang)}
              </button>
            </>
          ) : (
            <>
              <span>{t("clients.bulk.selectedOnPage", lang).replace("{count}", String(selectedCount))}</span>
              <button
                type="button"
                onClick={() => void selectAllMatchingNow()}
                data-testid="clients-select-all-matching"
                className="font-semibold text-brand-500 hover:underline"
              >
                {t("clients.bulk.selectAllMatching", lang).replace("{total}", String(total))}
              </button>
            </>
          )}
        </div>
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

      {/* Bulk action bar — sticky to the viewport bottom. Extra actions live in
          an upward-opening "More" menu so the bar stays mobile-safe. */}
      {selectedCount > 0 && (
        <div
          data-testid="clients-bulk-bar"
          className="sticky bottom-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/30 bg-white/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur dark:border-brand-500/30 dark:bg-slate-900/95"
        >
          <span className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {t("clients.lists.selected", lang)} · {selectedCount}
          </span>

          {/* Add to list */}
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              disabled={bulkBusy}
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
                    onClick={() => void runAddToList(l.id)}
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
                  onClick={() => { setAddMenuOpen(false); openCreateList("selection"); }}
                  className="mt-1 flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-brand-500 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("clients.bulk.newListFromSelection", lang)}
                </button>
              </div>
            )}
          </div>

          {selectedListId && (
            <button
              type="button"
              onClick={() => void runRemoveFromList()}
              disabled={bulkBusy}
              data-testid="clients-bulk-remove"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              {t("clients.lists.removeFrom", lang)}
            </button>
          )}

          {/* More actions */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setMoreMenuOpen((v) => !v)}
              disabled={bulkBusy}
              data-testid="clients-bulk-more"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              {t("clients.bulk.more", lang)}
            </button>
            {moreMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 z-30 mb-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900"
              >
                <MoreItem icon={Plus} label={t("clients.bulk.newListFromSelection", lang)} onClick={() => openCreateList("selection")} testId="clients-more-newlist" />
                <MoreItem icon={Megaphone} label={t("clients.bulk.createBroadcast", lang)} onClick={() => openCreateList("broadcast")} testId="clients-more-broadcast" />
                <MoreItem icon={Download} label={t("clients.bulk.exportSelected", lang)} onClick={() => void runExport("manicbot", [...selectedIds])} testId="clients-more-export" />
                <div className="my-1 border-t border-slate-100 dark:border-white/5" />
                <MoreItem icon={Ban} label={t("clients.bulk.block", lang)} onClick={() => { setMoreMenuOpen(false); setConfirm("block"); }} testId="clients-more-block" />
                <MoreItem icon={ShieldCheck} label={t("clients.bulk.unblock", lang)} onClick={() => void runBulkBlock(false)} testId="clients-more-unblock" />
                <div className="my-1 border-t border-slate-100 dark:border-white/5" />
                <MoreItem icon={Trash2} label={t("clients.bulk.delete", lang)} onClick={() => { setMoreMenuOpen(false); setConfirm("delete"); }} testId="clients-more-delete" danger />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={clearSelection}
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
          onCreated={handleListCreated}
        />
      )}

      <ConfirmDialog
        open={confirm === "delete"}
        tone="danger"
        busy={bulkBusy}
        title={t("clients.bulk.deleteConfirm.title", lang)}
        description={t("clients.bulk.deleteConfirm.body", lang).replace("{count}", String(selectedCount))}
        confirmLabel={t("clients.bulk.delete", lang)}
        onConfirm={() => { setConfirm(null); void runBulkDelete(); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "block"}
        tone="warning"
        busy={bulkBusy}
        title={t("clients.bulk.blockConfirm.title", lang)}
        description={t("clients.bulk.blockConfirm.body", lang).replace("{count}", String(selectedCount))}
        confirmLabel={t("clients.bulk.block", lang)}
        onConfirm={() => { setConfirm(null); void runBulkBlock(true); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/** Outside-click closer shared by the header dropdowns (export/add/more). */
function useOutsideClose(
  ref: React.RefObject<HTMLDivElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, open, close]);
}

function MoreItem({
  icon: Icon,
  label,
  onClick,
  testId,
  danger = false,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  testId: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      data-testid={testId}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
          : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
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
