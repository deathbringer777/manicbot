"use client";

/**
 * SystemMarketingCampaignsClient — Cross-tenant campaigns list.
 *
 * Lists every campaign across every tenant (plus platform-owned campaigns
 * where `tenant_id IS NULL`). Status + channel filters. Click a row to
 * expand the per-campaign sends breakdown inline. Sysadmin-only.
 */

import { useState } from "react";
import Link from "next/link";
import { Mail, Filter, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { SystemMarketingShell } from "../SystemMarketingShell";

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused" | "failed";
type CampaignChannel = "email" | "sms" | "whatsapp";

const STATUS_OPTIONS: Array<{ value: CampaignStatus | "all"; label: string }> = [
  { value: "all", label: "Все статусы" },
  { value: "draft", label: "Черновик" },
  { value: "scheduled", label: "Запланировано" },
  { value: "sending", label: "Идёт отправка" },
  { value: "sent", label: "Отправлено" },
  { value: "paused", label: "Пауза" },
  { value: "failed", label: "Ошибка" },
];

const CHANNEL_OPTIONS: Array<{ value: CampaignChannel | "all"; label: string }> = [
  { value: "all", label: "Все каналы" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "draft":
      return { label: "draft", cls: "bg-slate-500/10 text-slate-500" };
    case "scheduled":
      return { label: "scheduled", cls: "bg-blue-500/10 text-blue-400" };
    case "sending":
      return { label: "sending", cls: "bg-amber-500/10 text-amber-500" };
    case "sent":
      return { label: "sent", cls: "bg-emerald-500/10 text-emerald-500" };
    case "paused":
      return { label: "paused", cls: "bg-slate-500/10 text-slate-400" };
    case "failed":
      return { label: "failed", cls: "bg-red-500/10 text-red-500" };
    default:
      return { label: status, cls: "bg-slate-500/10 text-slate-500" };
  }
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function CampaignSendsBreakdown({ id }: { id: string }) {
  const statsQ = api.marketing.campaignStats.useQuery({ id });
  if (statsQ.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
        ))}
      </div>
    );
  }
  const s = statsQ.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-3 gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3 text-center text-xs dark:border-white/5 dark:bg-slate-900/40 md:grid-cols-6">
      <KV label="Всего" value={s.total} />
      <KV label="В очереди" value={s.queued} tone="neutral" />
      <KV label="Отправлено" value={s.sent} tone="good" />
      <KV label="Доставлено" value={s.delivered} tone="good" />
      <KV label="Ошибки" value={s.failed} tone={s.failed ? "bad" : "neutral"} />
      <KV label="Возвраты" value={s.bounced} tone={s.bounced ? "warn" : "neutral"} />
    </div>
  );
}

function KV({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "good" | "warn" | "bad" | "neutral" }) {
  const toneClass =
    tone === "good"
      ? "text-emerald-500"
      : tone === "warn"
      ? "text-amber-500"
      : tone === "bad"
      ? "text-red-500"
      : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-lg bg-white px-2 py-2 dark:bg-slate-900/60">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-bold ${toneClass}`}>{value.toLocaleString()}</div>
    </div>
  );
}

export default function SystemMarketingCampaignsClient() {
  const { role } = useRole();
  const [status, setStatus] = useState<CampaignStatus | "all">("all");
  const [channel, setChannel] = useState<CampaignChannel | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const listQ = api.marketing.campaignsList.useQuery(
    {
      status: status === "all" ? undefined : status,
      channel: channel === "all" ? undefined : channel,
    },
    { enabled: role === "system_admin", refetchInterval: 60_000 },
  );

  const rows = listQ.data ?? [];

  return (
    <SystemMarketingShell title="Кампании" subtitle="Все кампании платформы — кросс-тенантный обзор">
      <div className="space-y-4">
        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CampaignStatus | "all")}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as CampaignChannel | "all")}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {CHANNEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="ml-auto text-[11px] text-slate-500">
            {listQ.isLoading ? "загрузка…" : `${rows.length.toLocaleString()} кампаний`}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          {listQ.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Mail className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-700" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {status !== "all" || channel !== "all"
                  ? "Под выбранные фильтры ничего нет."
                  : "Кампании на платформе ещё не создавались."}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left dark:border-white/5">
                  <th className="px-4 py-2 font-medium text-slate-500">Кампания</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Канал</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Статус</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Тенант</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Стартовала</th>
                  <th className="px-4 py-2 font-medium text-slate-500">Обновлена</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((c) => {
                  const badge = statusBadge(c.status);
                  const open = expanded === c.id;
                  return (
                    <>
                      <tr
                        key={c.id}
                        onClick={() => setExpanded(open ? null : c.id)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900 dark:text-white">{c.name}</div>
                          <div className="font-mono text-[10px] text-slate-400">{c.id}</div>
                        </td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{c.channel}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-500">
                          {c.tenantId ?? <span className="italic text-amber-500">platform</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-500">{fmtDate(c.startedAt)}</td>
                        <td className="px-4 py-2 text-slate-500">{fmtDate(c.updatedAt)}</td>
                      </tr>
                      {open && (
                        <tr key={`${c.id}-detail`}>
                          <td colSpan={6} className="bg-slate-50/50 p-0 dark:bg-slate-900/20">
                            <CampaignSendsBreakdown id={c.id} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer hint — links back to overview + tenant marketing */}
        <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">
          Это представление кросс-тенантное.{" "}
          <Link href="/marketing" className="text-violet-500 hover:underline">
            /marketing
          </Link>{" "}
          — салон-сторона.{" "}
          <Link href="/system/providers" className="text-violet-500 hover:underline">
            /system/providers
          </Link>{" "}
          — вендоры доставки (Resend / Brevo / Twilio).
        </p>
      </div>
    </SystemMarketingShell>
  );
}

// Suppress unused-icon import warnings.
export const _icons = { Send, AlertTriangle, CheckCircle2 };
