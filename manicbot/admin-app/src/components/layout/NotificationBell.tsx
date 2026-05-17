"use client";

/**
 * NotificationBell — header-mounted bell with unread badge + a VK / Facebook-
 * inspired dropdown of the 12 most recent notifications.
 *
 * Polls notifications.unreadCount every 30 s (5 s when dropdown open).
 * Click a row to navigate to its link and mark it read.
 *
 * Visual contract (PR 2 of the notification center upgrade):
 *  - Per-`kind` icon in a colored circle on the left (kindMeta helper)
 *  - Title + 1-line body preview
 *  - Relative time on the right
 *  - Rows split into «Новые» (last 24 h) and «Ранее» groups
 *  - Tabs «Все» / «Непрочитанные» drive a server-side `unreadOnly` filter
 *  - Footer link to /notifications (full history page)
 *
 * Backend writers register kinds in lib/notifications/kindMeta.ts — the
 * dropdown does not need patching when a new writer is added.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, X, CheckCheck, Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import {
  BELL_GROUP_TITLE,
  bellGroup,
  formatRelative,
  kindMeta,
  type BellGroup,
} from "~/lib/notifications/kindMeta";

const DROPDOWN_LIMIT = 12;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const unread = api.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: open ? 5_000 : 30_000,
    refetchIntervalInBackground: false,
  });

  const list = api.notifications.list.useQuery(
    { limit: DROPDOWN_LIMIT, unreadOnly: filter === "unread" },
    {
      enabled: open,
      refetchInterval: open ? 5_000 : false,
    },
  );

  const utils = api.useUtils();
  const markRead = api.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });
  const markAll = api.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = unread.data?.count ?? 0;

  const grouped = useMemo(() => {
    const items = list.data ?? [];
    const buckets: Record<BellGroup, typeof items> = { new: [], earlier: [] };
    for (const n of items) buckets[bellGroup(n.createdAt)].push(n);
    return buckets;
  }, [list.data]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="notification-bell"
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span
            data-testid="notification-bell-badge"
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notification-bell-panel"
          className="absolute right-0 top-10 z-50 w-[22rem] sm:w-[26rem] rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl shadow-black/30 dark:shadow-black/60 overflow-hidden"
        >
          {/* Header — title + tabs + actions */}
          <div className="px-4 pt-3 pb-2 border-b border-slate-100 dark:border-white/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Уведомления
              </p>
              <div className="flex items-center gap-0.5">
                {count > 0 && (
                  <button
                    type="button"
                    onClick={() => markAll.mutate()}
                    disabled={markAll.isPending}
                    title="Прочитать всё"
                    data-testid="notification-bell-mark-all"
                    className="p-1.5 rounded-md text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Tabs — All / Unread (server-side filter). */}
            <div className="flex items-center rounded-lg bg-slate-100 dark:bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => setFilter("all")}
                data-testid="notification-bell-tab-all"
                className={`flex-1 text-[11px] font-medium py-1 rounded-md transition-colors ${
                  filter === "all"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Все
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                data-testid="notification-bell-tab-unread"
                className={`flex-1 text-[11px] font-medium py-1 rounded-md transition-colors flex items-center justify-center gap-1 ${
                  filter === "unread"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Непрочитанные
                {count > 0 && (
                  <span className="text-[9px] font-bold text-rose-500 bg-rose-500/10 px-1 rounded">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Body — grouped list */}
          <div className="max-h-96 overflow-y-auto">
            {list.isLoading && (
              <p className="px-4 py-8 text-center text-xs text-slate-400">Загрузка…</p>
            )}
            {list.data && list.data.length === 0 && (
              <div className="px-4 py-10 text-center text-slate-400">
                <Inbox className="h-6 w-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">
                  {filter === "unread" ? "Нет непрочитанных" : "Нет уведомлений"}
                </p>
              </div>
            )}

            {(["new", "earlier"] as const).map((group) => {
              const rows = grouped[group];
              if (!rows.length) return null;
              return (
                <section key={group} data-testid={`notification-bell-group-${group}`}>
                  <h3 className="px-4 pt-2.5 pb-1 text-[10px] uppercase font-bold tracking-wider text-slate-400">
                    {BELL_GROUP_TITLE[group]}
                  </h3>
                  <ul>
                    {rows.map((n) => {
                      const isUnread = n.readAt === null;
                      const meta = kindMeta(n.kind);
                      const Icon = meta.icon;
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            data-testid="notification-bell-row"
                            data-kind={n.kind}
                            data-unread={isUnread ? "true" : "false"}
                            onClick={() => {
                              if (isUnread) markRead.mutate({ ids: [n.id] });
                              if (n.link) {
                                router.push(n.link);
                                setOpen(false);
                              }
                            }}
                            className={`w-full text-left px-4 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04] ${
                              isUnread ? "bg-indigo-500/[0.04]" : ""
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${meta.accent}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                  <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                    {n.title}
                                  </p>
                                  {isUnread && (
                                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                                  )}
                                </div>
                                {n.body && (
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                                    {n.body}
                                  </p>
                                )}
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  {formatRelative(n.createdAt)}
                                </p>
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* Footer — full history link */}
          <div className="px-4 py-2 border-t border-slate-100 dark:border-white/5 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              data-testid="notification-bell-see-all"
              className="text-[11px] font-medium text-indigo-500 hover:text-indigo-600"
            >
              Все уведомления →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
