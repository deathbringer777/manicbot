"use client";

/**
 * Right-drawer activity feed.
 * Shows the most recent platform events; 5s refresh when open.
 */

import { useEffect, useState } from "react";
import { Bell, X, Activity as ActivityIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { useRole } from "~/components/RoleContext";
import { t } from "~/lib/i18n";

function timeAgo(ts: number, lang: string): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return lang === "en" ? `${Math.round(diff)}s` : `${Math.round(diff)}с`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

export function ActivityFeed() {
  const { role } = useRole();
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const eventsQ = api.events.getRecent.useQuery(
    { limit: 50 },
    { enabled: open && role === "system_admin", refetchInterval: open ? 5_000 : false },
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (role !== "system_admin") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="activity-feed-toggle"
        aria-label="Activity feed"
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 w-10 h-10 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center border border-slate-700 hover:bg-slate-800"
      >
        <ActivityIcon size={16} />
      </button>
      {open && (
        <aside
          data-testid="activity-feed-drawer"
          role="complementary"
          className="fixed top-0 right-0 h-full w-full sm:w-96 z-50 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-white/10 shadow-2xl flex flex-col"
        >
          <header className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-white/10">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              <Bell size={14} /> Activity
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              <X size={14} />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto" data-testid="activity-feed-list">
            {(() => {
              const raw: unknown = eventsQ.data;
              const list: Array<Record<string, unknown>> = Array.isArray(raw)
                ? (raw as Array<Record<string, unknown>>)
                : ((raw as { events?: Array<Record<string, unknown>> })?.events ?? []);
              if (eventsQ.isLoading) return <div className="p-6 text-xs text-slate-400">…</div>;
              if (list.length === 0) return <div className="p-6 text-xs text-slate-400">{t("plugins.catalog.emptyResult", lang)}</div>;
              return (
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {list.map((ev, idx) => {
                    const lvl = String(ev.level ?? "info");
                    const ts = Number(ev.created_at ?? ev.createdAt ?? 0);
                    const key = typeof ev.id === "number" ? ev.id : idx;
                    const cls = lvl === "error" ? "bg-red-500" : lvl === "warn" ? "bg-amber-500" : "bg-emerald-500";
                    return (
                      <li key={key} className="p-3 text-xs text-slate-700 dark:text-slate-200 flex items-start gap-2">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${cls}`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{String(ev.message ?? "")}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {String(ev.type ?? "")} · {timeAgo(ts, lang)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </div>
        </aside>
      )}
    </>
  );
}
