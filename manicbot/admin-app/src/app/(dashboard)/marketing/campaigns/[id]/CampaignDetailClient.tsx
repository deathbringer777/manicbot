"use client";

/**
 * Campaign detail / results — Brevo-style funnel for one email campaign.
 *
 * Reads the cumulative funnel from `campaignReport` (correct opens/clicks via
 * timestamp columns) + the per-recipient breakdown from `campaignSendsList`.
 * While the campaign is in-flight (`sending`/`scheduled`) both queries poll;
 * polling self-terminates once the report's own status reaches a terminal
 * state. God Mode (cross-tenant) redacts recipient emails; a tenant owner sees
 * their own contacts' addresses.
 */

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Send, CheckCircle2, Eye, MousePointerClick, Target,
  XCircle, AlertTriangle, Flag, Clock, Check,
} from "lucide-react";
import { MarketingShell } from "../../MarketingShell";
import { useMarketingScope } from "../../useMarketingScope";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { redactEmail } from "~/lib/redact";
import { KpiCard } from "~/components/ui/KpiCard";

const PAGE_SIZE = 100;
const POLL_REPORT_MS = 4000;
const POLL_SENDS_MS = 6000;

function isInFlight(status: string | undefined): boolean {
  return status === "sending" || status === "scheduled";
}

function pct(x: number): string {
  return `${Math.round((x ?? 0) * 100)}%`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

type SendRow = {
  id: string;
  recipient: string;
  status: string;
  sentAt: number | null;
  deliveredAt: number | null;
  openedAt: number | null;
  clickedAt: number | null;
  bouncedAt: number | null;
};

/** God Mode returns flat `marketing_sends` rows; tenant returns the innerJoin
 *  shape `{ marketing_sends, marketing_campaigns }`. Normalize both. */
function normalizeSend(row: unknown): SendRow {
  const obj = row as Record<string, unknown>;
  const r = (obj && typeof obj === "object" && "marketing_sends" in obj
    ? (obj.marketing_sends as Record<string, unknown>)
    : obj) ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    id: String(r.id ?? ""),
    recipient: String(r.recipient ?? ""),
    status: String(r.status ?? ""),
    sentAt: num(r.sentAt),
    deliveredAt: num(r.deliveredAt),
    openedAt: num(r.openedAt),
    clickedAt: num(r.clickedAt),
    bouncedAt: num(r.bouncedAt),
  };
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300",
  scheduled: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  sending: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  paused: "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-300",
};

function StatusBadge({ status, lang }: { status: string; lang: any }) {
  const key = `marketing.campaign.status.${status}` as Parameters<typeof t>[0];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold uppercase ${STATUS_TONE[status] ?? STATUS_TONE.draft}`}>
      {t(key, lang)}
    </span>
  );
}

function Metric({
  label, value, icon: Icon, tone = "default",
}: {
  label: string; value: string | number; icon: any; tone?: "default" | "good" | "warn" | "bad";
}) {
  const valueTone =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
    tone === "bad" ? "text-red-600 dark:text-red-400" :
    "text-slate-900 dark:text-slate-100";
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wide font-semibold mb-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${valueTone}`}>{value}</div>
    </div>
  );
}

/** Horizontal funnel bar — width relative to the audience denominator. */
function FunnelBar({ label, count, denom, rate, color }: {
  label: string; count: number; denom: number; rate?: string; color: string;
}) {
  const width = clamp01(denom > 0 ? count / denom : 0) * 100;
  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="w-28 shrink-0 text-slate-500 dark:text-slate-400">{label}</div>
      <div className="flex-1 h-5 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${width}%` }} />
      </div>
      <div className="w-24 shrink-0 text-right tabular-nums font-semibold text-slate-700 dark:text-slate-200">
        {count.toLocaleString()}{rate ? <span className="ml-1 font-normal text-slate-400">{rate}</span> : null}
      </div>
    </div>
  );
}

function Tick({ at }: { at: number | null }) {
  return at ? <Check className="h-3.5 w-3.5 text-emerald-500 inline" /> : <span className="text-slate-300 dark:text-slate-600">—</span>;
}

export default function CampaignDetailClient({ id }: { id: string }) {
  const { lang } = useLang();
  const { mode, tenantId } = useMarketingScope();
  const [offset, setOffset] = useState(0);

  const adminReportQ = api.marketing.campaignReport.useQuery(
    { id },
    {
      enabled: mode === "admin",
      refetchInterval: (q) => (isInFlight(q.state.data?.campaign.status) ? POLL_REPORT_MS : false),
    },
  );
  const tenantReportQ = api.marketingTenant.campaignReport.useQuery(
    { tenantId: tenantId ?? "", id },
    {
      enabled: mode === "tenant" && !!tenantId,
      refetchInterval: (q) => (isInFlight(q.state.data?.campaign.status) ? POLL_REPORT_MS : false),
    },
  );
  const reportQ = mode === "admin" ? adminReportQ : tenantReportQ;
  const report = reportQ.data;
  const status = report?.campaign.status;

  const adminSendsQ = api.marketing.campaignSendsList.useQuery(
    { id, limit: PAGE_SIZE, offset },
    { enabled: mode === "admin", refetchInterval: () => (isInFlight(status) ? POLL_SENDS_MS : false) },
  );
  const tenantSendsQ = api.marketingTenant.campaignSendsList.useQuery(
    { tenantId: tenantId ?? "", id, limit: PAGE_SIZE, offset },
    { enabled: mode === "tenant" && !!tenantId, refetchInterval: () => (isInFlight(status) ? POLL_SENDS_MS : false) },
  );
  const sendsQ = mode === "admin" ? adminSendsQ : tenantSendsQ;
  const sends: SendRow[] = (sendsQ.data ?? []).map(normalizeSend);

  if (reportQ.isLoading) {
    return (
      <MarketingShell title="Marketing • Campaign" subtitle="">
        <div className="text-xs text-slate-500 py-10 text-center">{t("common.loading", lang)}…</div>
      </MarketingShell>
    );
  }
  if (reportQ.isError || !report) {
    return (
      <MarketingShell title="Marketing • Campaign" subtitle="">
        <Link href="/marketing/campaigns" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("marketing.campaign.detail.back", lang)}
        </Link>
        <div className="text-center py-10 text-slate-500">{t("marketing.campaign.detail.notFound", lang)}</div>
      </MarketingShell>
    );
  }

  const { campaign, funnel, rates } = report;
  const isEmail = campaign.channel === "email";
  const denom = campaign.audienceTotal && campaign.audienceTotal > funnel.total
    ? campaign.audienceTotal
    : funnel.total;
  const progress = clamp01(funnel.sent / (campaign.audienceTotal ?? (funnel.total || 1)));
  const hasNextPage = offset + PAGE_SIZE < funnel.total;

  return (
    <MarketingShell title={campaign.name} subtitle={campaign.channel}>
      <Link href="/marketing/campaigns" className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> {t("marketing.campaign.detail.back", lang)}
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <StatusBadge status={campaign.status} lang={lang} />
        <span className="text-xs text-slate-500">
          {t("marketing.campaign.detail.recipients", lang)}: <span className="font-semibold tabular-nums">{(campaign.audienceTotal ?? funnel.total).toLocaleString()}</span>
        </span>
      </div>

      {/* In-flight progress */}
      {isInFlight(campaign.status) && (
        <div className="mb-5 rounded-xl border border-violet-200 dark:border-violet-900/40 bg-violet-50 dark:bg-violet-950/30 p-4">
          <div className="flex items-center justify-between text-xs text-violet-800 dark:text-violet-200 mb-2">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Send className="h-3.5 w-3.5" /> {t("marketing.campaign.progress.label", lang)}
            </span>
            <span className="tabular-nums">
              {t("marketing.campaign.progress.of", lang)
                .replace("{sent}", String(funnel.sent))
                .replace("{total}", String(campaign.audienceTotal ?? funnel.total))}
            </span>
          </div>
          <div className="h-2 rounded-full bg-violet-200 dark:bg-violet-900/50 overflow-hidden">
            <div className="h-full bg-violet-600 transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}

      {/* Funnel KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        <KpiCard label={t("marketing.campaign.funnel.sent", lang)} value={funnel.sent}
          icon={Send} iconBg="bg-slate-500/15" iconColor="text-slate-600 dark:text-slate-300" />
        <KpiCard label={t("marketing.campaign.funnel.delivered", lang)} value={funnel.delivered}
          subtext={`${pct(rates.deliveredRate)} · ${t("marketing.campaign.rate.delivered", lang)}`}
          icon={CheckCircle2} iconBg="bg-emerald-500/15" iconColor="text-emerald-600 dark:text-emerald-400" />
        {isEmail && (
          <>
            <KpiCard label={t("marketing.campaign.funnel.opened", lang)} value={funnel.opened}
              subtext={`${pct(rates.openRate)} · ${t("marketing.campaign.rate.open", lang)}`}
              icon={Eye} iconBg="bg-sky-500/15" iconColor="text-sky-600 dark:text-sky-400" />
            <KpiCard label={t("marketing.campaign.funnel.clicked", lang)} value={funnel.clicked}
              subtext={`${pct(rates.clickRate)} · ${t("marketing.campaign.rate.click", lang)}`}
              icon={MousePointerClick} iconBg="bg-violet-500/15" iconColor="text-violet-600 dark:text-violet-400" />
            <KpiCard label={t("marketing.campaign.funnel.converted", lang)} value={funnel.conversions}
              subtext={`${pct(rates.conversionRate)} · ${t("marketing.campaign.rate.conversion", lang)}`}
              icon={Target} iconBg="bg-amber-500/15" iconColor="text-amber-600 dark:text-amber-400" />
          </>
        )}
      </div>

      {!isEmail && (
        <p className="mb-5 text-xs text-slate-500 dark:text-slate-400">{t("marketing.campaign.detail.noTracking", lang)}</p>
      )}

      {/* Secondary counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric label={t("marketing.campaign.funnel.failed", lang)} value={funnel.failed} icon={XCircle} tone={funnel.failed > 0 ? "bad" : "default"} />
        <Metric label={t("marketing.campaign.funnel.bounced", lang)} value={funnel.bounced} icon={AlertTriangle} tone={funnel.bounced > 0 ? "warn" : "default"} />
        <Metric label={t("marketing.campaign.funnel.complained", lang)} value={funnel.complained} icon={Flag} tone={funnel.complained > 0 ? "warn" : "default"} />
        <Metric label={t("marketing.campaign.funnel.queued", lang)} value={funnel.queued} icon={Clock} tone="default" />
      </div>

      {/* Funnel bars */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 mb-5 space-y-2.5">
        <FunnelBar label={t("marketing.campaign.funnel.sent", lang)} count={funnel.sent} denom={denom} color="bg-slate-400" />
        <FunnelBar label={t("marketing.campaign.funnel.delivered", lang)} count={funnel.delivered} denom={denom} rate={pct(rates.deliveredRate)} color="bg-emerald-500" />
        {isEmail && <FunnelBar label={t("marketing.campaign.funnel.opened", lang)} count={funnel.opened} denom={denom} rate={pct(rates.openRate)} color="bg-sky-500" />}
        {isEmail && <FunnelBar label={t("marketing.campaign.funnel.clicked", lang)} count={funnel.clicked} denom={denom} rate={pct(rates.clickRate)} color="bg-violet-500" />}
        {isEmail && <FunnelBar label={t("marketing.campaign.funnel.converted", lang)} count={funnel.conversions} denom={denom} rate={pct(rates.conversionRate)} color="bg-amber-500" />}
      </div>

      {/* Per-recipient table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
          {t("marketing.campaign.detail.recipients", lang)}
        </h3>
        {sends.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-sm text-slate-700 dark:text-slate-400 font-medium mb-1">{t("marketing.campaign.detail.empty.title", lang)}</div>
            <div className="text-xs text-slate-500">{t("marketing.campaign.detail.empty.subtitle", lang)}</div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[680px] w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left font-semibold py-2 pr-3">{t("marketing.campaign.table.recipient", lang)}</th>
                    <th className="text-left font-semibold py-2 px-2">{t("marketing.campaign.table.status", lang)}</th>
                    <th className="text-center font-semibold py-2 px-2">{t("marketing.campaign.funnel.sent", lang)}</th>
                    <th className="text-center font-semibold py-2 px-2">{t("marketing.campaign.funnel.delivered", lang)}</th>
                    {isEmail && <th className="text-center font-semibold py-2 px-2">{t("marketing.campaign.funnel.opened", lang)}</th>}
                    {isEmail && <th className="text-center font-semibold py-2 px-2">{t("marketing.campaign.funnel.clicked", lang)}</th>}
                    <th className="text-center font-semibold py-2 pl-2">{t("marketing.campaign.funnel.bounced", lang)}</th>
                  </tr>
                </thead>
                <tbody>
                  {sends.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className="py-2 pr-3 font-mono text-slate-700 dark:text-slate-300 truncate max-w-[220px]">
                        {mode === "admin" ? redactEmail(s.recipient) : s.recipient}
                      </td>
                      <td className="py-2 px-2"><StatusBadge status={s.status} lang={lang} /></td>
                      <td className="py-2 px-2 text-center"><Tick at={s.sentAt} /></td>
                      <td className="py-2 px-2 text-center"><Tick at={s.deliveredAt} /></td>
                      {isEmail && <td className="py-2 px-2 text-center"><Tick at={s.openedAt} /></td>}
                      {isEmail && <td className="py-2 px-2 text-center"><Tick at={s.clickedAt} /></td>}
                      <td className="py-2 pl-2 text-center"><Tick at={s.bouncedAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-3 text-xs">
              <button type="button" disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                className="rounded px-3 py-1 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800">
                {t("marketing.campaign.table.prev", lang)}
              </button>
              <span className="tabular-nums text-slate-400">
                {offset + 1}–{offset + sends.length} / {funnel.total.toLocaleString()}
              </span>
              <button type="button" disabled={!hasNextPage}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                className="rounded px-3 py-1 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800">
                {t("marketing.campaign.table.next", lang)}
              </button>
            </div>
          </>
        )}
      </div>
    </MarketingShell>
  );
}
