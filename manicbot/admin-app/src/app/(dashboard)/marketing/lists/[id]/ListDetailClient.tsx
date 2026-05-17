"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2, Mail, Phone, Users, Search, X } from "lucide-react";
import { api } from "~/trpc/react";
import { MarketingShell } from "../../MarketingShell";
import { useMarketingScope } from "../../useMarketingScope";
import { EmptyState } from "~/components/ui/EmptyState";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";

const FIELD =
  "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-violet-500/50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";

export default function ListDetailClient({ id }: { id: string }) {
  const { mode, tenantId } = useMarketingScope();
  const isTenant = mode === "tenant" && !!tenantId;
  const [showAdd, setShowAdd] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ contactId: number; name: string | null } | null>(null);

  // Resolve list metadata via the segments list (cheap — typically a few rows).
  const segmentsQ = api.marketingTenant.segmentsList.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: isTenant },
  );
  const meta = useMemo(
    () => (segmentsQ.data ?? []).find((s: any) => s.id === id),
    [segmentsQ.data, id],
  );

  const membersQ = api.marketingTenant.segmentMembersList.useQuery(
    { tenantId: tenantId ?? "", segmentId: id, limit: 200, offset: 0 },
    { enabled: isTenant },
  );

  const utils = api.useUtils();
  const removeM = api.marketingTenant.segmentRemoveContacts.useMutation({
    onSuccess: () => {
      void utils.marketingTenant.segmentMembersList.invalidate({ tenantId: tenantId ?? "", segmentId: id });
      void utils.marketingTenant.segmentsList.invalidate({ tenantId: tenantId ?? "" });
    },
  });

  if (!isTenant) {
    return (
      <MarketingShell title="Marketing • List">
        <EmptyState
          icon={Users}
          title="Списки — только в режиме салона"
          description="Откройте конкретного тенанта (или вернитесь в режим «Превью как salon owner»), чтобы посмотреть содержимое списка."
        />
      </MarketingShell>
    );
  }

  const members = (membersQ.data?.items ?? []) as any[];
  const total = membersQ.data?.total ?? 0;

  return (
    <MarketingShell
      title={meta?.name ? `Список • ${meta.name}` : "Список"}
      subtitle={meta?.description ?? `${total} контактов`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/marketing/contacts"
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Все списки
        </Link>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить контакты
        </button>
      </div>

      {membersQ.isLoading ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Список пуст"
          description="Добавьте контакты, чтобы запускать рассылки только на них."
          action={{ label: "Добавить контакты", onClick: () => setShowAdd(true) }}
        />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Имя</th>
                  <th className="text-left px-3 py-2">Телефон</th>
                  <th className="text-left px-3 py-2">Статус</th>
                  <th className="text-right px-3 py-2">Действие</th>
                </tr>
              </thead>
              <tbody>
                {members.map((c: any) => (
                  <tr key={c.id} className="border-t border-slate-200/60 dark:border-slate-800/60">
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
                    <td className="px-3 py-2">
                      {c.unsubscribed ? (
                        <span className="text-[10px] text-rose-500 dark:text-rose-400">unsubscribed</span>
                      ) : (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">active</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setConfirmRemove({ contactId: c.id, name: c.name })}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        title="Убрать из списка"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && tenantId && (
        <AddContactsToListModal
          tenantId={tenantId}
          segmentId={id}
          onClose={() => setShowAdd(false)}
        />
      )}

      <ConfirmDialog
        open={!!confirmRemove}
        tone="warning"
        title="Убрать из списка?"
        description={confirmRemove
          ? `Контакт${confirmRemove.name ? ` «${confirmRemove.name}»` : ""} останется в общей базе, но больше не получит рассылки этого списка.`
          : ""}
        confirmLabel="Убрать"
        onConfirm={() => {
          if (confirmRemove && tenantId) {
            removeM.mutate({ tenantId, segmentId: id, contactIds: [confirmRemove.contactId] });
          }
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </MarketingShell>
  );
}

// ─── Add-contacts modal ─────────────────────────────────────────────────────

function AddContactsToListModal({
  tenantId,
  segmentId,
  onClose,
}: {
  tenantId: string;
  segmentId: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  // Pull a wide window of tenant contacts; user filters on the client.
  const candidatesQ = api.marketingTenant.contactsList.useQuery(
    { tenantId, search, limit: 100, offset: 0 },
    { enabled: !!tenantId },
  );

  const utils = api.useUtils();
  const addM = api.marketingTenant.segmentAddContacts.useMutation({
    onSuccess: () => {
      void utils.marketingTenant.segmentMembersList.invalidate({ tenantId, segmentId });
      void utils.marketingTenant.segmentsList.invalidate({ tenantId });
      onClose();
    },
    onError: (e) => setErr(e.message),
  });

  function toggle(id: number) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setErr(null);
    if (picked.size === 0) {
      setErr("Выберите хотя бы один контакт.");
      return;
    }
    addM.mutate({
      tenantId,
      segmentId,
      contactIds: Array.from(picked),
    });
  }

  const items = (candidatesQ.data?.items ?? []) as any[];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "92vh", display: "flex", flexDirection: "column" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Добавить контакты в список
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 dark:bg-white/5 dark:text-white/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по email / имени / телефону…"
              className={`${FIELD} pl-8`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {candidatesQ.isLoading ? (
            <div className="flex items-center justify-center py-10 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">
              {search ? "Никого не нашли по этому запросу." : "В базе ещё нет контактов — сначала добавьте клиентов в салоне."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {items.map((c: any) => {
                const isPicked = picked.has(c.id);
                return (
                  <li key={c.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-xs transition ${
                        isPicked
                          ? "bg-violet-50/60 dark:bg-violet-500/10"
                          : "hover:bg-slate-50 dark:hover:bg-slate-900/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isPicked}
                        onChange={() => toggle(c.id)}
                        className="accent-violet-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-slate-900 dark:text-slate-100 font-medium">
                          {c.name ?? c.email ?? c.phone ?? `#${c.id}`}
                        </div>
                        <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                          {c.email ?? "—"} · {c.phone ?? "—"}
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {err && (
          <div className="px-4 py-2 text-xs text-red-700 dark:text-red-300">{err}</div>
        )}

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <span className="text-xs text-slate-500">Выбрано: {picked.size}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.05]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={picked.size === 0 || addM.isPending}
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              {addM.isPending ? "…" : "Добавить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
