"use client";

/**
 * Marketing • Contacts page.
 *
 * Three sections:
 *
 *   1. **Lists** — Brevo-style manual lists (marketing_segments with
 *      kind='manual'). Owner creates a list, then bulk-adds contacts from
 *      this same page or one-by-one from a contact row. Each list links to
 *      `marketingTenant.segmentMembersList` for a member-only view.
 *
 *   2. **Contacts table** — same shape as before, but the loading /
 *      empty / error branches now render a friendly EmptyState with a
 *      CTA back to the Salon Clients tab (which is the canonical
 *      contact-create surface — the marketing directory is downstream of
 *      `users` via `marketingSync`).
 *
 *   3. **Selection toolbar** — when 1+ contact rows are ticked, an action
 *      bar pops out at the top of the table with «Добавить в список» and
 *      «Снять выбор» buttons. Selection state is page-scoped (clears on
 *      search / filter change) so the user never sees a stale tick on a
 *      row they can no longer see.
 *
 * God Mode (admin scope) is unchanged — admin sees the platform-wide
 * directory and doesn't get the lists UI (lists are tenant-scoped).
 */

import { useState, useMemo, useEffect } from "react";
import { api } from "~/trpc/react";
import { MarketingShell } from "../MarketingShell";
import {
  Loader2, Mail, Phone, Search, Ban, Plus, Users, ListChecks, X,
  ExternalLink, Trash2, Sparkles,
} from "lucide-react";
import { useMarketingScope } from "../useMarketingScope";
import { EmptyState } from "~/components/ui/EmptyState";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import Link from "next/link";

const FIELD_BASE =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-violet-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";

function fmtDate(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function ContactsClient() {
  const [search, setSearch] = useState("");
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const { mode, tenantId } = useMarketingScope();
  const isTenant = mode === "tenant" && !!tenantId;

  const adminListQ = api.marketing.contactsList.useQuery(
    { search, subscribedOnly, limit: 100, offset: 0 },
    { enabled: mode === "admin" },
  );
  const tenantListQ = api.marketingTenant.contactsList.useQuery(
    { tenantId: tenantId ?? "", search, subscribedOnly, limit: 100, offset: 0 },
    { enabled: isTenant },
  );
  const listQ = mode === "admin" ? adminListQ : tenantListQ;

  const listsQ = api.marketingTenant.segmentsList.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: isTenant },
  );

  return (
    <MarketingShell title="Marketing • Contacts" subtitle="CRM база: лиды, клиенты салонов, web-users">
      {isTenant && tenantId && (
        <ListsSection
          tenantId={tenantId}
          lists={(listsQ.data ?? []) as any}
          loading={listsQ.isLoading}
        />
      )}

      {/* Toolbar — search + filter + add/import. */}
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
      ) : (listQ.data?.items.length ?? 0) === 0 ? (
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[720px]">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-wide">
                <tr>
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
                {listQ.data?.items.map((c: any) => (
                  <tr key={c.id} className="border-t border-slate-200/60 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-900/30">
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
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{c.source ?? "—"}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

function CreateListModal({
  tenantId,
  onClose,
}: {
  tenantId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const utils = api.useUtils();
  const create = api.marketingTenant.segmentCreate.useMutation({
    onSuccess: () => {
      void utils.marketingTenant.segmentsList.invalidate({ tenantId });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Укажите название списка.");
      return;
    }
    create.mutate({
      tenantId,
      name: name.trim(),
      description: description.trim() || undefined,
      kind: "manual",
      filterJson: "{}",
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Новый список
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-white/70">
              Название *
            </label>
            <input
              autoFocus
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, VIP"
              className={`${FIELD_BASE} px-3 py-2`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-white/70">
              Описание (необязательно)
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Кого включать в этот список — для себя и команды."
              className={`${FIELD_BASE} px-3 py-2 resize-none`}
            />
          </div>
          {err && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
              {err}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.05]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={create.isPending || !name.trim()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              {create.isPending ? "…" : "Создать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
