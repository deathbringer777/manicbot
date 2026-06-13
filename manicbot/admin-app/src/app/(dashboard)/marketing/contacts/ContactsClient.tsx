"use client";

/**
 * Marketing • Contacts page.
 *
 * Sections:
 *
 *   1. **Lists** — Brevo-style manual lists (marketing_segments with
 *      kind='manual'). Owner creates a list, then bulk-adds contacts from
 *      this same page or one-by-one from a contact row. Each list links to
 *      `marketingTenant.segmentMembersList` for a member-only view.
 *
 *   2. **Contacts table** — checkbox gutter per row + a three-state "select
 *      all" header checkbox (Gmail-style). A page-size selector
 *      (25/50/100/Все) controls how many rows load; "Все" loads the full set
 *      so "select all" then covers everything. The loading / empty / error
 *      branches render a friendly EmptyState with a CTA back to the Salon
 *      Clients tab (the canonical contact-create surface — the marketing
 *      directory is downstream of `users` via `marketingSync`).
 *
 *   3. **Selection action bar** (tenant scope only) — pops out when 1+ rows
 *      are ticked: «Добавить в список» (+ «Новый список из выбранных»),
 *      «Создать кампанию из выбранных», «Отписать»/«Подписать», and a danger
 *      «Удалить навсегда» (marketing-only — the salon client record stays).
 *      Selection clears on search / filter / page-size change so a tick never
 *      lingers on a row the user can no longer see.
 *
 * God Mode (admin scope) is read-only here — admin sees the platform-wide
 * directory and gets neither the lists UI nor the action bar (both are
 * tenant-scoped, and platform rows can have tenant_id = null).
 */

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { MarketingShell } from "../MarketingShell";
import {
  Loader2, Mail, Phone, Search, Ban, Plus, Users, ListChecks,
  ExternalLink, Trash2, Sparkles,
  Check, Minus, ChevronDown, X, Megaphone, MoreHorizontal,
} from "lucide-react";
import { useMarketingScope } from "../useMarketingScope";
import { useLang } from "~/components/LangContext";
import { t, type Lang } from "~/lib/i18n";
import { EmptyState } from "~/components/ui/EmptyState";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { CreateListModal } from "~/components/marketing/CreateListModal";
import Link from "next/link";

const FIELD_BASE =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-violet-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";

/** Server caps every bulk mutation at 500 ids/call — chunk larger selections. */
const BULK_CHUNK = 500;
/** "Показать все" ceiling — matches the contactsList limit cap (server side). */
const MAX_PAGE = 1000;
const PAGE_SIZES = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number] | "all";

/** Run `fn` over `ids` in fixed-size batches, sequentially. */
async function inChunks(ids: number[], size: number, fn: (batch: number[]) => Promise<void>) {
  for (let i = 0; i < ids.length; i += size) {
    await fn(ids.slice(i, i + size));
  }
}

interface ContactRow {
  id: number;
  email: string | null;
  name: string | null;
  phone: string | null;
  source: string | null;
  lifecycleStage: string | null;
  lastSeenAt: number | null;
  unsubscribed: number;
}

function fmtDate(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Friendly RU labels for the raw `source` slugs written by marketingSync /
// booking flows — the raw `salon_clients_manual` etc. looked techy in the UI.
const SOURCE_LABELS: Record<string, string> = {
  salon_clients_manual: "Клиент салона",
  salon_clients_import: "Импорт CSV",
  booking_manual: "Ручная запись",
  public_booking: "Онлайн-запись",
};
function sourceLabel(source?: string | null): string {
  if (!source) return "—";
  return SOURCE_LABELS[source] ?? source;
}

const CHECKBOX_BASE =
  "flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition";

export default function ContactsClient() {
  const [search, setSearch] = useState("");
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [pageSize, setPageSize] = useState<PageSize>(100);
  const [offset, setOffset] = useState(0);
  const { mode, tenantId } = useMarketingScope();
  const isTenant = mode === "tenant" && !!tenantId;
  const { lang } = useLang();
  const router = useRouter();
  const utils = api.useUtils();

  const effLimit = pageSize === "all" ? MAX_PAGE : pageSize;
  const effOffset = pageSize === "all" ? 0 : offset;

  const adminListQ = api.marketing.contactsList.useQuery(
    { search, subscribedOnly, limit: effLimit, offset: effOffset },
    { enabled: mode === "admin" },
  );
  const tenantListQ = api.marketingTenant.contactsList.useQuery(
    { tenantId: tenantId ?? "", search, subscribedOnly, limit: effLimit, offset: effOffset },
    { enabled: isTenant },
  );
  const listQ = mode === "admin" ? adminListQ : tenantListQ;

  const listsQ = api.marketingTenant.segmentsList.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: isTenant },
  );

  const items = (listQ.data?.items ?? []) as ContactRow[];
  const total = listQ.data?.total ?? 0;
  const manualLists = useMemo(
    () => ((listsQ.data ?? []) as Array<{ id: string; name: string; kind: string; contactCount: number }>)
      .filter((l) => l.kind === "manual"),
    [listsQ.data],
  );

  // ── Selection state ─────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [createListOpen, setCreateListOpen] = useState(false);
  const [listIntent, setListIntent] = useState<"selection" | "broadcast">("selection");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [acting, setActing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const addMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Reset paging + selection whenever the result set changes shape — never
  // leave a tick (or a stale offset) on a row the user can no longer see.
  useEffect(() => {
    setOffset(0);
    setSelectedIds(new Set());
  }, [search, subscribedOnly, pageSize, mode, tenantId]);

  // Close the action-bar dropdowns on an outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) setAddMenuOpen(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const loadedIds = useMemo(() => items.map((c) => c.id), [items]);
  const allLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selectedIds.has(id));
  const someLoadedSelected = !allLoadedSelected && loadedIds.some((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const toggleSelect = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  function toggleSelectAllLoaded() {
    if (allLoadedSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(loadedIds));
  }
  function clearSelection() { setSelectedIds(new Set()); }

  // ── Mutations + handlers ────────────────────────────────────────────────
  const addContactsMut = api.marketingTenant.segmentAddContacts.useMutation();
  const setSubMut = api.marketingTenant.contactsSetSubscribed.useMutation();
  const deleteMut = api.marketingTenant.contactsDelete.useMutation();
  const bulkBusy = acting || addContactsMut.isPending || setSubMut.isPending || deleteMut.isPending;

  function flashMsg(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }
  function refreshAfterBulk() {
    if (mode === "admin") void utils.marketing.contactsList.invalidate();
    else void utils.marketingTenant.contactsList.invalidate();
    if (tenantId) void utils.marketingTenant.segmentsList.invalidate({ tenantId });
    setSelectedIds(new Set());
  }

  async function runAddToList(segmentId: string) {
    if (!tenantId) return;
    const ids = [...selectedIds];
    setActing(true);
    let added = 0, skipped = 0;
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        const r = await addContactsMut.mutateAsync({ tenantId, segmentId, contactIds: batch });
        added += r.added; skipped += r.skipped;
      });
      setAddMenuOpen(false);
      const extra = skipped ? ` · ${skipped} ${t("marketing.contacts.lists.skipped", lang)}` : "";
      flashMsg(`${t("marketing.contacts.lists.added", lang)}: ${added}${extra}`);
      refreshAfterBulk();
    } finally { setActing(false); }
  }

  function openCreateList(intent: "selection" | "broadcast") {
    setListIntent(intent);
    setCreateListOpen(true);
    setAddMenuOpen(false);
    setMoreMenuOpen(false);
  }

  // After CreateListModal returns the new id: push the selection into it, then
  // either stay (selection) or hand off to the campaign creator (broadcast).
  function handleListCreated(segmentId: string) {
    if (!tenantId) return;
    const intent = listIntent;
    const ids = [...selectedIds];
    void (async () => {
      setActing(true);
      try {
        await inChunks(ids, BULK_CHUNK, async (batch) => {
          await addContactsMut.mutateAsync({ tenantId, segmentId, contactIds: batch });
        });
        if (intent === "broadcast") {
          router.push(`/marketing/campaigns?segmentId=${encodeURIComponent(segmentId)}`);
          return;
        }
        flashMsg(`${t("marketing.contacts.lists.added", lang)}: ${ids.length}`);
        refreshAfterBulk();
      } finally { setActing(false); }
    })();
  }

  async function runBulkUnsub(unsubscribed: boolean) {
    if (!tenantId) return;
    const ids = [...selectedIds];
    setActing(true);
    let updated = 0;
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        const r = await setSubMut.mutateAsync({ tenantId, contactIds: batch, unsubscribed });
        updated += r.updated;
      });
      setMoreMenuOpen(false);
      flashMsg(
        t(unsubscribed ? "marketing.contacts.bulk.unsubscribed" : "marketing.contacts.bulk.resubscribed", lang)
          .replace("{count}", String(updated)),
      );
      refreshAfterBulk();
    } finally { setActing(false); }
  }

  async function runBulkDelete() {
    if (!tenantId) return;
    const ids = [...selectedIds];
    setActing(true);
    let deleted = 0;
    try {
      await inChunks(ids, BULK_CHUNK, async (batch) => {
        const r = await deleteMut.mutateAsync({ tenantId, contactIds: batch });
        deleted += r.deleted;
      });
      flashMsg(t("marketing.contacts.bulk.deleted", lang).replace("{count}", String(deleted)));
      refreshAfterBulk();
    } finally { setActing(false); }
  }

  const canPage = pageSize !== "all" && total > (pageSize as number);

  return (
    <MarketingShell title="Marketing • Contacts" subtitle="CRM база: лиды, клиенты салонов, web-users">
      {isTenant && tenantId && (
        <ListsSection
          tenantId={tenantId}
          lists={(listsQ.data ?? []) as any}
          loading={listsQ.isLoading}
        />
      )}

      {flash && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          {flash}
        </div>
      )}

      {/* Toolbar — search + filter + page size + total. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по email, имени, телефону…"
            className={`${FIELD_BASE} pl-8 pr-3`}
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={subscribedOnly}
            onChange={(e) => setSubscribedOnly(e.target.checked)}
            className="accent-violet-500"
          />
          Только подписаны
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          {t("marketing.contacts.page.size", lang)}
          <select
            value={String(pageSize)}
            onChange={(e) => {
              const v = e.target.value;
              setPageSize(v === "all" ? "all" : (Number(v) as PageSize));
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-violet-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="all">{t("marketing.contacts.page.showAll", lang)}</option>
          </select>
        </label>
        <div className="text-xs text-slate-500 ml-auto">
          Всего: <b className="text-slate-900 dark:text-slate-200 tabular-nums">{listQ.data?.total ?? "—"}</b>
        </div>
      </div>

      {listQ.isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : listQ.isError ? (
        <EmptyState
          icon={Users}
          title="Не удалось загрузить контакты"
          description={listQ.error?.message ?? "Попробуйте обновить страницу."}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Пока нет контактов"
          description={isTenant
            ? "Контакты появятся автоматически после первой записи или импорта клиентов салона. Можете начать с CRM салона."
            : "Платформа ещё не собрала ни одного лида."}
          action={isTenant
            ? { label: "Открыть «Клиенты»", href: "/dashboard?tab=clients" }
            : undefined}
          secondaryAction={isTenant
            ? { label: "Импорт CSV", href: "/dashboard?tab=clients" }
            : undefined}
        />
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[760px]">
                <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-wide">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={allLoadedSelected ? true : someLoadedSelected ? "mixed" : false}
                        aria-label={t("marketing.contacts.bulk.selectAll", lang)}
                        data-testid="contacts-select-all"
                        onClick={toggleSelectAllLoaded}
                        className={`${CHECKBOX_BASE} ${
                          allLoadedSelected || someLoadedSelected
                            ? "border-violet-500 bg-violet-500 text-white"
                            : "border-slate-300 bg-white hover:border-violet-400 dark:border-white/20 dark:bg-white/[0.04]"
                        }`}
                      >
                        {allLoadedSelected ? <Check className="h-2.5 w-2.5" strokeWidth={3} />
                          : someLoadedSelected ? <Minus className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                      </button>
                    </th>
                    <th className="text-left px-3 py-2">Email</th>
                    <th className="text-left px-3 py-2">Имя</th>
                    <th className="text-left px-3 py-2">Телефон</th>
                    <th className="text-left px-3 py-2">Источник</th>
                    <th className="text-left px-3 py-2">Lifecycle</th>
                    <th className="text-left px-3 py-2">Последний контакт</th>
                    <th className="text-left px-3 py-2">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => {
                    const selected = selectedIds.has(c.id);
                    return (
                      <tr
                        key={c.id}
                        className={`border-t border-slate-200/60 dark:border-slate-800/60 ${
                          selected
                            ? "bg-violet-50/60 dark:bg-violet-950/20"
                            : "hover:bg-slate-50 dark:hover:bg-slate-900/30"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={selected}
                            aria-label="select-contact"
                            data-testid={`contact-select-${c.id}`}
                            onClick={() => toggleSelect(c.id)}
                            className={`${CHECKBOX_BASE} ${
                              selected
                                ? "border-violet-500 bg-violet-500 text-white"
                                : "border-slate-300 bg-white hover:border-violet-400 dark:border-white/20 dark:bg-white/[0.04]"
                            }`}
                          >
                            {selected && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-mono text-[11px]">
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3 text-slate-500" />
                            {c.email ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.name ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                          {c.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 text-slate-500" />{c.phone}</span> : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{sourceLabel(c.source)}</td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{c.lifecycleStage ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtDate(c.lastSeenAt)}</td>
                        <td className="px-3 py-2">
                          {c.unsubscribed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-rose-500 dark:text-rose-400">
                              <Ban className="h-3 w-3" /> unsubscribed
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400">active</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {canPage && (
            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-500">
              <span className="tabular-nums">
                {offset + 1}–{Math.min(offset + effLimit, total)} / {total}
              </span>
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - effLimit))}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
              >
                {t("marketing.contacts.page.prev", lang)}
              </button>
              <button
                type="button"
                disabled={offset + effLimit >= total}
                onClick={() => setOffset(offset + effLimit)}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
              >
                {t("marketing.contacts.page.next", lang)}
              </button>
            </div>
          )}
        </>
      )}

      {/* Selection action bar — tenant scope only (lists/campaigns are tenant-scoped). */}
      {isTenant && selectedCount > 0 && (
        <div
          data-testid="contacts-bulk-bar"
          className="sticky bottom-2 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/30 bg-white/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur dark:border-violet-500/30 dark:bg-slate-900/95"
        >
          <span className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
            {t("marketing.contacts.lists.selected", lang)} · {selectedCount}
          </span>

          {/* Add to list */}
          <div className="relative" ref={addMenuRef}>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => setAddMenuOpen((v) => !v)}
              data-testid="contacts-bulk-add"
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("marketing.contacts.lists.addTo", lang)}
              <ChevronDown className="h-3 w-3 opacity-80" />
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900"
              >
                {manualLists.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-slate-400">{t("marketing.contacts.lists.empty", lang)}</p>
                )}
                {manualLists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void runAddToList(l.id)}
                    data-testid={`contacts-bulk-add-${l.id}`}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                  >
                    <span className="truncate">{l.name}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-slate-400">{l.contactCount}</span>
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openCreateList("selection")}
                  className="mt-1 flex w-full items-center gap-1.5 border-t border-slate-100 px-3 py-2 text-left text-xs font-semibold text-violet-600 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("marketing.contacts.bulk.newListFromSelection", lang)}
                </button>
              </div>
            )}
          </div>

          {/* More actions */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => setMoreMenuOpen((v) => !v)}
              data-testid="contacts-bulk-more"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              {t("marketing.contacts.bulk.more", lang)}
            </button>
            {moreMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full left-0 z-30 mb-1 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openCreateList("broadcast")}
                  data-testid="contacts-bulk-campaign"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  {t("marketing.contacts.bulk.createCampaign", lang)}
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-white/5" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runBulkUnsub(true)}
                  data-testid="contacts-bulk-unsub"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  <Ban className="h-3.5 w-3.5" />
                  {t("marketing.contacts.bulk.unsubscribe", lang)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runBulkUnsub(false)}
                  data-testid="contacts-bulk-resub"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("marketing.contacts.bulk.resubscribe", lang)}
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-white/5" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMoreMenuOpen(false); setConfirmDelete(true); }}
                  data-testid="contacts-bulk-delete"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("marketing.contacts.bulk.delete", lang)}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={clearSelection}
            data-testid="contacts-bulk-clear"
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:hover:bg-white/5"
          >
            <X className="h-3.5 w-3.5" />
            {t("marketing.contacts.lists.clear", lang)}
          </button>
        </div>
      )}

      {isTenant && tenantId && createListOpen && (
        <CreateListModal
          tenantId={tenantId}
          lang={lang as Lang}
          onClose={() => setCreateListOpen(false)}
          onCreated={handleListCreated}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        busy={bulkBusy}
        title={t("marketing.contacts.bulk.deleteConfirm.title", lang)}
        description={t("marketing.contacts.bulk.deleteConfirm.body", lang).replace("{count}", String(selectedCount))}
        confirmLabel={t("marketing.contacts.bulk.delete", lang)}
        onConfirm={() => { setConfirmDelete(false); void runBulkDelete(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </MarketingShell>
  );
}

// ─── Lists section ──────────────────────────────────────────────────────────

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  contactCount: number;
}

function ListsSection({
  tenantId,
  lists,
  loading,
}: {
  tenantId: string;
  lists: ListRow[];
  loading: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  const utils = api.useUtils();
  const del = api.marketingTenant.segmentDelete.useMutation({
    onSuccess: () => {
      void utils.marketingTenant.segmentsList.invalidate({ tenantId });
    },
  });

  return (
    <div className="mb-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-violet-50/40 to-white p-4 dark:from-violet-950/20 dark:to-slate-900/40">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ListChecks className="h-4 w-4 text-violet-500" />
            Списки клиентов
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Сгруппируйте контакты, чтобы отправлять кампании только на них (как «Lists» в Brevo).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Создать список
        </button>
      </div>

      {loading ? (
        <div className="py-3 text-center text-xs text-slate-500">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        </div>
      ) : lists.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 p-5 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-violet-400 mb-2" />
          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Создайте первый список — например, «VIP» или «Постоянные».
          </p>
          <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
            Дальше добавите туда контактов и сможете запускать на них рассылки.
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => (
            <div
              key={l.id}
              className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-violet-300 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-violet-500/40"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/marketing/lists/${encodeURIComponent(l.id)}`}
                    className="truncate text-xs font-semibold text-slate-900 hover:underline dark:text-slate-100"
                  >
                    {l.name}
                  </Link>
                  {l.kind === "manual" && (
                    <span className="rounded bg-violet-100 px-1 py-px text-[9px] font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                      list
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {l.contactCount} контактов
                  {l.description ? <> · {l.description}</> : null}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <Link
                  href={`/marketing/lists/${encodeURIComponent(l.id)}`}
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  title="Открыть"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ id: l.id, name: l.name })}
                  className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  title="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateListModal
          tenantId={tenantId}
          onClose={() => setShowCreate(false)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        tone="danger"
        title="Удалить список?"
        description={confirmDelete
          ? `Список «${confirmDelete.name}» и его связи с контактами будут удалены. Сами контакты останутся.`
          : ""}
        confirmLabel="Удалить"
        onConfirm={() => {
          if (confirmDelete) {
            del.mutate({ tenantId, id: confirmDelete.id });
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
