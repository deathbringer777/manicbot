"use client";

/**
 * NotificationBell — header-mounted bell with unread badge + dropdown
 * of the 10 most recent notifications. Polls notifications.unreadCount
 * every 30s (5s when dropdown open). Click a row to navigate to its
 * link and mark it read.
 *
 * Generic surface — the reminders plugin is the first writer
 * (kind='reminder.fired') but every future feature uses the same router.
 */

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const unread = api.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: open ? 5_000 : 30_000,
    refetchIntervalInBackground: false,
  });

  const list = api.notifications.list.useQuery({ limit: 10 }, {
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  });

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
          className="absolute right-0 top-10 z-50 w-80 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl shadow-black/30 dark:shadow-black/60 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Уведомления
            </p>
            <div className="flex items-center gap-1">
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="text-[10px] text-indigo-500 hover:text-indigo-600 px-1.5 py-0.5"
                >
                  Прочитать всё
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {list.isLoading && (
              <li className="px-4 py-6 text-center text-xs text-slate-400">Загрузка…</li>
            )}
            {list.data && list.data.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-slate-400">Нет уведомлений</li>
            )}
            {list.data?.map((n) => {
              const isUnread = n.readAt === null;
              const row = (
                <button
                  type="button"
                  onClick={() => {
                    if (isUnread) markRead.mutate({ ids: [n.id] });
                    if (n.link) {
                      router.push(n.link);
                      setOpen(false);
                    }
                  }}
                  className={`w-full text-left px-4 py-2.5 border-b border-slate-100 dark:border-white/5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04] ${isUnread ? "bg-indigo-500/[0.04]" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    {isUnread && <span className="mt-1 h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{n.title}</p>
                      {n.body && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{n.body}</p>
                      )}
                    </div>
                  </div>
                </button>
              );
              return n.link ? (
                <li key={n.id}>{row}</li>
              ) : (
                <li key={n.id}>{row}</li>
              );
            })}
          </ul>

          <div className="px-4 py-2 border-t border-slate-100 dark:border-white/5 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
            >
              Все уведомления →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
