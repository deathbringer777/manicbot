"use client";

/**
 * SystemMarketingClient — Overview page of the platform marketing center.
 *
 * Renders the front door for the sysadmin's cross-tenant marketing view:
 *   - 4 KPI cards (contacts, sends, delivery rate, active campaigns)
 *   - 7-day rollup (campaigns sent, contacts added, unsubscribes, sends failed)
 *   - Recent campaigns table (top 10, clickable into the Campaigns sub-page)
 *
 * Data source: `api.marketing.*` (adminProcedure, cross-tenant). The salon
 * owner's CRM at `/marketing/*` is intentionally NOT used here.
 */

import Link from "next/link";
import {
  Users, Mail, Activity, Send, Megaphone, Inbox, AlertTriangle, UserMinus, ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useRole } from "~/components/RoleContext";
import { SystemMarketingShell } from "./SystemMarketingShell";

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  loading?: boolean;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-500 dark:text-emerald-400"
      : tone === "warn"
      ? "text-amber-500 dark:text-amber-400"
      : tone === "bad"
      ? "text-red-500 dark:text-red-400"
      : "text-slate-900 dark:text-white";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      {loading ? (
        <div className="h-7 animate-pulse rounded bg-slate-200 dark:bg-slate-800/40" />
      ) : (
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      )}
      {hint && !loading && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  );
}

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  const v = (num / denom) * 100;
  if (v >= 99.95) return "100%";
  return `${v.toFixed(1)}%`;
}

function fmtDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

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

export default function SystemMarketingClient() {
  // RoleContext gate — defensive layer in addition to the URL convention.
  const { role } = useRole();

  // Always call hooks in the same order — gate via `enabled` rather than early return.
  const statsQ = api.marketing.stats.useQuery(undefined, {
    enabled: role === "system_admin",
    refetchInterval: 60_000,
  });
  const activityQ = api.marketing.activity.useQuery(
    { days: 7 },
    { enabled: role === "system_admin", refetchInterval: 60_000 },
  );
  const campaignsQ = api.marketing.campaignsList.useQuery(undefined, {
    enabled: role === "system_admin",
    refetchInterval: 60_000,
  });

  const stats = statsQ.data;
  const activity = activityQ.data;
  const recentCampaigns = (campaignsQ.data ?? []).slice(0, 10);

  // Send totals across all statuses (queued + sent + failed + delivered + bounced…).
  const sendsTotal = stats
    ? Object.values(stats.sends).reduce((a, b) => a + Number(b), 0)
    : 0;
  const sendsSent = Number(stats?.sends?.sent ?? 0) + Number(stats?.sends?.delivered ?? 0);
  const sendsFailed = Number(stats?.sends?.failed ?? 0) + Number(stats?.sends?.bounced ?? 0);
  const deliveryRate = pct(sendsSent, sendsSent + sendsFailed);

  const campaignsActive =
    Number(stats?.campaigns?.sending ?? 0) + Number(stats?.campaigns?.scheduled ?? 0);

  return (
    <SystemMarketingShell>
      <div className="space-y-5">
        {/* Hero strap — distinguishes from the tenant /marketing surface */}
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-transparent to-violet-500/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Платформенный маркетинг
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Кросс-тенантные кампании, воронка регистраций и состояние доставки по всей платформе.
                Это не CRM салона — для салон-стороны{" "}
                <Link href="/marketing" className="text-violet-500 underline-offset-2 hover:underline">
                  /marketing
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            icon={Users}
            label="Контакты"
            value={(stats?.contacts.total ?? 0).toLocaleString()}
            hint={`${(stats?.contacts.subscribed ?? 0).toLocaleString()} подписаны`}
            loading={statsQ.isLoading}
          />
          <StatCard
            icon={Send}
            label="Всего отправлено"
            value={sendsTotal.toLocaleString()}
            hint={sendsFailed ? `${sendsFailed.toLocaleString()} ошибок` : undefined}
            tone={sendsFailed > sendsSent && sendsTotal > 0 ? "warn" : "neutral"}
            loading={statsQ.isLoading}
          />
          <StatCard
            icon={Activity}
            label="Delivery rate"
            value={deliveryRate}
            hint={sendsTotal > 0 ? `${sendsSent.toLocaleString()} / ${(sendsSent + sendsFailed).toLocaleString()}` : "нет отправок"}
            tone={sendsSent + sendsFailed === 0 ? "neutral" : sendsSent / Math.max(1, sendsSent + sendsFailed) > 0.95 ? "good" : "warn"}
            loading={statsQ.isLoading}
          />
          <StatCard
            icon={Megaphone}
            label="Активные кампании"
            value={campaignsActive.toLocaleString()}
            hint={`${stats?.campaigns?.sent ?? 0} завершены`}
            loading={statsQ.isLoading}
          />
        </div>

        {/* 7-day rollup */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <Activity className="h-3.5 w-3.5" />
            За последние 7 дней
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              icon={Mail}
              label="Кампаний отправлено"
              value={activity?.campaignsSent ?? 0}
              loading={activityQ.isLoading}
            />
            <StatCard
              icon={Inbox}
              label="Новых контактов"
              value={activity?.contactsAdded ?? 0}
              loading={activityQ.isLoading}
            />
            <StatCard
              icon={AlertTriangle}
              label="Сообщений упало"
              value={activity?.sendsFailed ?? 0}
              tone={activity?.sendsFailed && activity.sendsFailed > 0 ? "warn" : "neutral"}
              loading={activityQ.isLoading}
            />
            <StatCard
              icon={UserMinus}
              label="Отписок"
              value={activity?.unsubscribes ?? 0}
              loading={activityQ.isLoading}
            />
          </div>
        </div>

        {/* Recent campaigns table */}
        <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Последние кампании</h3>
            <Link
              href="/system/marketing/campaigns"
              className="inline-flex items-center gap-1 text-xs font-medium text-violet-500 hover:underline"
            >
              Все кампании <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {campaignsQ.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded bg-slate-100 dark:bg-slate-800/40" />
              ))}
            </div>
          ) : recentCampaigns.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Пока нет кампаний на платформе.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left dark:border-white/5">
                    <th className="px-4 py-2 font-medium text-slate-500">Кампания</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Канал</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Статус</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Тенант</th>
                    <th className="px-4 py-2 font-medium text-slate-500">Обновлено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {recentCampaigns.map((c) => {
                    const badge = statusBadge(c.status);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
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
                        <td className="px-4 py-2 text-slate-500">{fmtDate(c.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </SystemMarketingShell>
  );
}
