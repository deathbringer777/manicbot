"use client";

import { useEffect, useState } from "react";
import {
  Users as GroupIcon,
  User as DmIcon,
  Bell as SystemIcon,
  MessageCircle as ClientIcon,
  ClipboardList as RequestIcon,
  Search,
  Plus,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { useMessengerSocketCtx } from "./socketContext";

type ThreadKind = "staff_dm" | "staff_group" | "client_conv" | "system" | "requests";
type FilterKind = ThreadKind | "all";

const KIND_META: Record<ThreadKind, { icon: typeof DmIcon; tint: string }> = {
  staff_dm: { icon: DmIcon, tint: "bg-blue-500/15 text-blue-500" },
  staff_group: { icon: GroupIcon, tint: "bg-purple-500/15 text-purple-500" },
  client_conv: { icon: ClientIcon, tint: "bg-emerald-500/15 text-emerald-500" },
  system: { icon: SystemIcon, tint: "bg-amber-500/15 text-amber-500" },
  requests: { icon: RequestIcon, tint: "bg-amber-500/15 text-amber-600" },
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
  const { lang } = useLang();
  const { status: wsStatus } = useMessengerSocketCtx();

  const threadsQ = api.messenger.listThreads.useQuery(
    {
      tenantId,
      kind: filter === "all" ? undefined : filter,
      archived: false,
      limit: 50,
    },
    {
      // Slow poll when realtime is healthy; fast when the socket is down.
      refetchInterval: wsStatus === "open" ? 15000 : 5000,
      refetchOnWindowFocus: true,
      enabled: !!tenantId,
    },
  );

  const items = (threadsQ.data?.items ?? []).filter((th) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return (
      (th.title?.toLowerCase().includes(needle) ?? false) ||
      (th.lastMessagePreview?.toLowerCase().includes(needle) ?? false)
    );
  });

  // Full-text search over message BODIES (server FTS) — augments the instant
  // title/preview filter above. Debounced so we don't fire per keystroke.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const searching = debounced.length >= 2;
  const searchQ = api.messenger.searchMessages.useQuery(
    { tenantId, query: debounced, limit: 20 },
    { enabled: !!tenantId && searching },
  );
  const threadTitleById = new Map(
    (threadsQ.data?.items ?? []).map((th) => [
      th.id,
      th.title ??
        (th.kind === "staff_dm" ? t("messenger.thread.dm", lang) : t("messenger.thread.chat", lang)),
    ]),
  );

  return (
    <div className="flex h-full flex-col border-r border-slate-200 dark:border-slate-800">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100">
            {t("messenger.threadList.title", lang)}
            {(wsStatus === "connecting" || wsStatus === "error") && (
              <span
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"
                title={t("messenger.conn.reconnecting", lang)}
                aria-label={t("messenger.conn.reconnecting", lang)}
              />
            )}
          </h2>
          <button
            type="button"
            onClick={onNewThread}
            data-testid="new-thread-button"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/10 text-brand-500 hover:bg-brand-500/20"
            title={t("messenger.threadList.newChat", lang)}
            aria-label={t("messenger.threadList.newChat", lang)}
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
            placeholder={t("messenger.threadList.search", lang)}
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-900 placeholder-slate-400 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        {/* Filter pills */}
        <div className="mt-2 flex flex-wrap gap-1">
          {(["all", "requests", "staff_dm", "staff_group", "client_conv", "system"] as FilterKind[]).map(
            (k) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
                  filter === k
                    ? "bg-brand-500 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {k === "all"
                  ? t("messenger.filter.all", lang)
                  : k === "requests"
                    ? t("messenger.filter.requests", lang)
                    : k === "staff_dm"
                      ? "DM"
                      : k === "staff_group"
                        ? t("messenger.filter.groups", lang)
                        : k === "client_conv"
                          ? t("messenger.filter.clients", lang)
                          : t("messenger.filter.system", lang)}
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
        ) : items.length === 0 && !searching ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-xs text-slate-500">{t("messenger.threadList.empty", lang)}</p>
            <p className="mt-1 text-[10px] text-slate-400">
              {t("messenger.threadList.emptyHint", lang)}
            </p>
          </div>
        ) : (
          items.map((th) => {
            const meta = KIND_META[th.kind as ThreadKind] ?? KIND_META.system;
            const Icon = meta.icon;
            const isActive = selectedThreadId === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => onSelect(th.id)}
                data-testid={`thread-row-${th.id}`}
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
                      {th.title ?? (th.kind === "staff_dm"
                        ? t("messenger.thread.dm", lang)
                        : t("messenger.thread.chat", lang))}
                    </p>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {fmtTime(th.lastMessageAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
                    {th.lastMessagePreview ?? "—"}
                  </p>
                </div>
                {th.unreadCount > 0 && (
                  <span
                    className="ml-1 mt-0.5 shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[9px] font-bold text-white"
                    data-testid={`unread-badge-${th.id}`}
                  >
                    {th.unreadCount >= 99 ? "99+" : th.unreadCount}
                  </span>
                )}
              </button>
            );
          })
        )}

        {/* Full-text message search results (server FTS, membership-scoped) */}
        {searching && (
          <div className="border-t border-slate-200 dark:border-slate-800">
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {t("messenger.search.inMessages", lang)}
            </p>
            {searchQ.isLoading ? (
              <p className="px-3 py-2 text-[11px] text-slate-400">
                {t("messenger.search.searching", lang)}
              </p>
            ) : (searchQ.data?.items ?? []).length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-slate-400">
                {t("messenger.search.noResults", lang)}
              </p>
            ) : (
              (searchQ.data?.items ?? []).map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => onSelect(hit.threadId)}
                  data-testid={`search-hit-${hit.id}`}
                  className="flex w-full flex-col items-start gap-0.5 border-l-2 border-l-transparent px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <span className="line-clamp-2 text-[11px] text-slate-700 dark:text-slate-300">
                    {hit.body}
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {threadTitleById.get(hit.threadId) ?? t("messenger.thread.chat", lang)} ·{" "}
                    {fmtTime(hit.createdAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
