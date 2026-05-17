"use client";

import { useState } from "react";
import {
  Users as GroupIcon,
  User as DmIcon,
  Bell as SystemIcon,
  MessageCircle as ClientIcon,
  Search,
  Plus,
} from "lucide-react";
import { api } from "~/trpc/react";

type ThreadKind = "staff_dm" | "staff_group" | "client_conv" | "system";
type FilterKind = ThreadKind | "all";

const KIND_META: Record<ThreadKind, { icon: typeof DmIcon; tint: string }> = {
  staff_dm: { icon: DmIcon, tint: "bg-blue-500/15 text-blue-500" },
  staff_group: { icon: GroupIcon, tint: "bg-purple-500/15 text-purple-500" },
  client_conv: { icon: ClientIcon, tint: "bg-emerald-500/15 text-emerald-500" },
  system: { icon: SystemIcon, tint: "bg-amber-500/15 text-amber-500" },
};

function fmtTime(ts: number | null): string {
  if (!ts) return "";
  const ms = ts * 1000;
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  const d = new Date(ms);
  return d.toLocaleDateString();
}

interface Props {
  tenantId: string;
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNewThread: () => void;
}

export function ThreadList({ tenantId, selectedThreadId, onSelect, onNewThread }: Props) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const [search, setSearch] = useState("");

  const threadsQ = api.messenger.listThreads.useQuery(
    {
      tenantId,
      kind: filter === "all" ? undefined : filter,
      archived: false,
      limit: 50,
    },
    {
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
      enabled: !!tenantId,
    },
  );

  const items = (threadsQ.data?.items ?? []).filter((t) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      (t.title?.toLowerCase().includes(needle) ?? false) ||
      (t.lastMessagePreview?.toLowerCase().includes(needle) ?? false)
    );
  });

  return (
    <div className="flex h-full flex-col border-r border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Сообщения</h2>
          <button
            type="button"
            onClick={onNewThread}
            data-testid="new-thread-button"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500 hover:bg-brand-500/20"
            title="Новый чат"
            aria-label="Новый чат"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск…"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Filter pills */}
        <div className="mt-2 flex flex-wrap gap-1">
          {(["all", "staff_dm", "staff_group", "client_conv", "system"] as FilterKind[]).map(
            (k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                  filter === k
                    ? "bg-brand-500 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {k === "all"
                  ? "Все"
                  : k === "staff_dm"
                    ? "DM"
                    : k === "staff_group"
                      ? "Группы"
                      : k === "client_conv"
                        ? "Клиенты"
                        : "Система"}
              </button>
            ),
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {threadsQ.isLoading ? (
          <div className="space-y-1 p-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-xs text-slate-500">Пока пусто</p>
            <p className="mt-1 text-[10px] text-slate-400">
              Нажмите «+» чтобы начать чат
            </p>
          </div>
        ) : (
          items.map((t) => {
            const meta = KIND_META[t.kind as ThreadKind] ?? KIND_META.system;
            const Icon = meta.icon;
            const isActive = selectedThreadId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelect(t.id)}
                data-testid={`thread-row-${t.id}`}
                className={`flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors ${
                  isActive
                    ? "border-l-brand-500 bg-brand-500/5"
                    : "border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.tint}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {t.title ?? (t.kind === "staff_dm" ? "Прямое сообщение" : "Чат")}
                    </p>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {fmtTime(t.lastMessageAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                    {t.lastMessagePreview ?? "—"}
                  </p>
                </div>
                {t.unreadCount > 0 && (
                  <span
                    className="ml-1 mt-0.5 shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[9px] font-bold text-white"
                    data-testid={`unread-badge-${t.id}`}
                  >
                    {t.unreadCount >= 99 ? "99+" : t.unreadCount}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
