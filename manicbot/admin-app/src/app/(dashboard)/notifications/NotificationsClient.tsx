"use client";

/**
 * /notifications — full history view of the user's bell feed.
 *
 * Backed by the same `notifications.list` tRPC query as the header bell,
 * but unbounded (up to 100 rows) and grouped into "Сегодня / На этой
 * неделе / Ранее" buckets. The header bell footer links here, and PR2
 * will likely link here from the VK-style "See all" CTA too.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  Inbox,
  Loader2,
  Trash2,
} from "lucide-react";
import { api } from "~/trpc/react";
import {
  formatRelative,
  kindMeta,
  timeBucket,
  TIME_BUCKET_TITLE,
  type TimeBucket,
} from "~/lib/notifications/kindMeta";

export default function NotificationsClient() {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const list = api.notifications.list.useQuery(
    { limit: 100, unreadOnly: filter === "unread" },
    { refetchInterval: 30_000 },
  );

  const utils = api.useUtils();
  const markRead = api.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });
  const markAll = api.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });
  const dismiss = api.notifications.dismiss.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });

  const grouped = useMemo(() => {
    const items = list.data ?? [];
    const buckets: Record<TimeBucket, typeof items> = {
      today: [],
      week: [],
      older: [],
    };
    for (const n of items) {
      buckets[timeBucket(n.createdAt)].push(n);
    }
    return buckets;
  }, [list.data]);

  const totalCount = (list.data ?? []).length;
  const unreadCount = (list.data ?? []).filter((n) => n.readAt === null).length;

  function handleRowClick(n: { id: string; readAt: number | null; link: string | null }) {
    if (n.readAt === null) markRead.mutate({ ids: [n.id] });
    if (n.link) router.push(n.link);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-900 dark:text-white">Уведомления</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {totalCount} {totalCount === 1 ? "запись" : "записей"} · {unreadCount} непрочитано
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-lg border border-slate-200 dark:border-white/10 p-0.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              data-testid="notifications-filter-all"
              className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                filter === "all"
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Все
            </button>
            <button
              type="button"
              onClick={() => setFilter("unread")}
              data-testid="notifications-filter-unread"
              className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                filter === "unread"
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Непрочитанные
            </button>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              data-testid="notifications-mark-all"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Прочитать всё
            </button>
          )}
        </div>
      </header>

      {list.isLoading && (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {list.data && list.data.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Уведомлений пока нет</p>
          <p className="text-xs mt-1">
            Здесь появятся ответы поддержки, напоминания, дни рождения клиентов и многое другое.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {(["today", "week", "older"] as const).map((bucket) => {
          const rows = grouped[bucket];
          if (!rows.length) return null;
          return (
            <section key={bucket}>
              <h2 className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-2 px-1">
                {TIME_BUCKET_TITLE[bucket]}
              </h2>
              <ul className="space-y-1.5">
                {rows.map((n) => {
                  const meta = kindMeta(n.kind);
                  const Icon = meta.icon;
                  const accent = meta.accent;
                  const isUnread = n.readAt === null;
                  return (
                    <li
                      key={n.id}
                      data-testid="notifications-row"
                      data-unread={isUnread ? "true" : "false"}
                      className={`group rounded-xl border transition-all ${
                        isUnread
                          ? "border-indigo-500/20 bg-indigo-500/[0.04] hover:bg-indigo-500/[0.08]"
                          : "border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-start gap-3 p-3">
                        <button
                          type="button"
                          onClick={() => handleRowClick(n)}
                          className="flex flex-1 items-start gap-3 text-left min-w-0"
                        >
                          <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${accent}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                {n.title}
                              </p>
                              {isUnread && (
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                              )}
                            </div>
                            {n.body && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                                {n.body}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1">
                              {formatRelative(n.createdAt)}
                              {n.link && <span className="ml-2 text-indigo-500">Перейти →</span>}
                            </p>
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label="Удалить"
                          onClick={() => dismiss.mutate({ id: n.id })}
                          disabled={dismiss.isPending}
                          className="p-1.5 rounded-md text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10 transition-all"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="mt-8 pt-4 border-t border-slate-100 dark:border-white/5 text-center">
        <Link
          href="/settings?section=appearance"
          className="text-[11px] text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          Настроить уведомления в Настройках →
        </Link>
      </footer>
    </div>
  );
}
