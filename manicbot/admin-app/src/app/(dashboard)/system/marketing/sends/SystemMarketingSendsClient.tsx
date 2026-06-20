"use client";

/**
 * SystemMarketingSendsClient — Platform-wide deliverability log.
 *
 * Cross-tenant recent sends from `marketing_sends`, joined with campaign
 * name + tenantId for context. Filters: status (queued/sent/delivered/
 * opened/clicked/bounced/complained/failed), recipient substring.
 *
 * Data flows from the Resend webhook (already wired) into status
 * transitions: queued → sent → delivered → opened/clicked, OR
 * → bounced/complained/failed (terminal). Brevo webhook ingestion is
 * a follow-up — sends originating via Brevo will stay at `queued/sent/
 * failed` until that lands.
 */

import { useState } from "react";
import {
  Send, Search, Filter, Mail, MessageSquare, AlertTriangle, ShieldAlert,
  CheckCircle2, Clock, MousePointerClick, Eye, type LucideIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { SystemMarketingShell } from "../SystemMarketingShell";
import { useLang } from "~/components/LangContext";
import { formatDate as i18nFormatDate, type Lang } from "~/lib/i18n";

const PAGE_SIZE = 100;

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "queued", label: "В очереди" },
  { value: "sent", label: "Отправлено" },
  { value: "delivered", label: "Доставлено" },
  { value: "opened", label: "Открыто" },
  { value: "clicked", label: "Переход" },
  { value: "bounced", label: "Bounce" },
  { value: "complained", label: "Спам-жалоба" },
  { value: "failed", label: "Ошибка" },
];

function statusBadge(status: string): { label: string; cls: string; Icon: LucideIcon } {
  switch (status) {
    case "queued":
      return { label: "queued", cls: "bg-slate-500/10 text-slate-500", Icon: Clock };
    case "sent":
      return { label: "sent", cls: "bg-blue-500/10 text-blue-500", Icon: Send };
    case "delivered":
      return { label: "delivered", cls: "bg-emerald-500/10 text-emerald-500", Icon: CheckCircle2 };
    case "opened":
      return { label: "opened", cls: "bg-cyan-500/10 text-cyan-500", Icon: Eye };
    case "clicked":
      return { label: "clicked", cls: "bg-violet-500/10 text-violet-500", Icon: MousePointerClick };
    case "bounced":
      return { label: "bounced", cls: "bg-amber-500/10 text-amber-500", Icon: AlertTriangle };
    case "complained":
      return { label: "complained", cls: "bg-red-500/10 text-red-500", Icon: ShieldAlert };
    case "failed":
      return { label: "failed", cls: "bg-red-500/10 text-red-500", Icon: AlertTriangle };
    default:
      return { label: status, cls: "bg-slate-500/10 text-slate-500", Icon: Clock };
  }
}

function channelIcon(channel: string | null | undefined): LucideIcon {
  return channel === "sms" || channel === "whatsapp" ? MessageSquare : Mail;
}

function fmtDate(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return "—";
  return i18nFormatDate(new Date(ts * 1000), lang, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function SystemMarketingSendsClient() {
  const { role } = useRole();
  const { lang } = useLang();
  const [status, setStatus] = useState<string>("all");
  const [recipient, setRecipient] = useState("");
  const [debouncedRecipient, setDebouncedRecipient] = useState("");
  const [offset, setOffset] = useState(0);

  useDebouncedEffect(
    () => {
      setDebouncedRecipient(recipient.trim());
      setOffset(0);
    },
    [recipient],
    250,
  );

  const listQ = api.marketing.sendsRecent.useQuery(
    {
      limit: PAGE_SIZE,
      offset,
      status: status === "all" ? undefined : status,
      recipient: debouncedRecipient || undefined,
    },
    { enabled: role === "system_admin", refetchInterval: 30_000 },
  );

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const hasMore = offset + items.length < total;
  const hasPrev = offset > 0;

  return (
    <SystemMarketingShell title="Логи отправки" subtitle="Доставка email и SMS по всей платформе">
      <div className="space-y-4">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Поиск по получателю (email или номер)…"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
          <span className="ml-auto text-[11px] text-slate-500">
            {listQ.isLoading ? "загрузка…" : `${total.toLocaleString()} событий`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          {listQ.isLoading && items.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Send className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {debouncedRecipient || status !== "all"
                  ? "Под выбранные фильтры событий нет."
                  : "Пока ничего не отправлялось через маркетинговый канал."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left dark:border-white/5">
                    <th className="px-4 py-2 font-medium text-slate-500"></th>
                    <th className="px-4 py-2 font-medium text-slate-500">Получатель</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Статус</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Кампания</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Тенант</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Провайдер</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Отправлено</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Последнее событие</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {items.map((row) => {
                    const badge = statusBadge(row.status);
                    const ChannelIcon = channelIcon(row.campaignChannel ?? null);
                    const lastEventAt =
                      row.complainedAt ??
                      row.bouncedAt ??
                      row.clickedAt ??
                      row.openedAt ??
                      row.deliveredAt ??
                      row.sentAt ??
                      row.queuedAt;
                    return (
                      <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                        <td className="px-4 py-2 align-middle">
                          <ChannelIcon className="h-3.5 w-3.5 text-slate-400" />
                        </td>
                        <td className="px-4 py-2 align-middle">
                          <div className="font-medium text-slate-900 dark:text-white">{row.recipient}</div>
                          {row.error && (
                            <div className="mt-0.5 truncate text-[10px] text-red-500" title={row.error}>
                              {row.error.slice(0, 80)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 align-middle">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                            <badge.Icon className="h-3 w-3" />
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 align-middle">
                          <div className="font-medium text-slate-700 dark:text-slate-300">
                            {row.campaignName ?? <span className="italic text-slate-400">—</span>}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">{row.campaignId}</div>
                        </td>
                        <td className="px-4 py-2 align-middle font-mono text-[11px]">
                          {row.tenantId ? (
                            <span className="text-slate-500">{row.tenantId}</span>
                          ) : (
                            <span className="italic text-amber-500">platform</span>
                          )}
                        </td>
                        <td className="px-4 py-2 align-middle text-slate-500">{row.provider}</td>
                        <td className="px-4 py-2 align-middle text-slate-500" title={fmtDate(row.sentAt ?? row.queuedAt, lang)}>
                          {fmtRelative(row.sentAt ?? row.queuedAt)}
                        </td>
                        <td className="px-4 py-2 align-middle text-slate-500" title={fmtDate(lastEventAt, lang)}>
                          {fmtRelative(lastEventAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div>
            {total > 0 && (
              <>
                {(offset + 1).toLocaleString()}–
                {Math.min(offset + items.length, total).toLocaleString()} из{" "}
                {total.toLocaleString()}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasPrev || listQ.isFetching}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              ← Назад
            </button>
            <button
              type="button"
              disabled={!hasMore || listQ.isFetching}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800"
            >
              Вперёд →
            </button>
          </div>
        </div>

        <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">
          События доставки приходят от провайдеров через webhooks:{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-800">/api/resend/webhook</code>{" "}
          (signature: Svix). Brevo-webhook добавится в следующем PR.
        </p>
      </div>
    </SystemMarketingShell>
  );
}

/** Tiny debounce hook to avoid pulling in another lib. */
import { useEffect } from "react";
function useDebouncedEffect(fn: () => void, deps: unknown[], delay: number) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
