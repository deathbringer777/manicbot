"use client";

/**
 * Marketing Overview — salon-owner facing summary of CRM activity.
 *
 * Provider plumbing (Brevo / Resend / Twilio) lives on `/system/providers`
 * (sysadmin-only). It used to render as a card here on the admin path,
 * but it's platform infrastructure, not a marketing surface — moved out
 * along with the navigation entry.
 */

import { MarketingShell } from "./MarketingShell";
import { api } from "~/trpc/react";
import {
  Users, Mail, Megaphone, Activity, Send, TrendingDown, AlertTriangle, UserPlus,
} from "lucide-react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { useMarketingScope } from "./useMarketingScope";

function Metric({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  icon: any;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const valueTone =
    tone === "good" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
    tone === "bad"  ? "text-red-600 dark:text-red-400" :
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

export default function OverviewClient() {
  const { lang } = useLang();
  const { mode, tenantId } = useMarketingScope();

  const adminStatsQ = api.marketing.stats.useQuery(undefined, { enabled: mode === "admin" });
  const tenantStatsQ = api.marketingTenant.stats.useQuery(
    { tenantId: tenantId ?? "" },
    { enabled: mode === "tenant" && !!tenantId },
  );
  const adminActivityQ = api.marketing.activity.useQuery({ days: 7 }, { enabled: mode === "admin" });
  const tenantActivityQ = api.marketingTenant.activity.useQuery(
    { tenantId: tenantId ?? "", days: 7 },
    { enabled: mode === "tenant" && !!tenantId },
  );

  const statsQ = mode === "admin" ? adminStatsQ : tenantStatsQ;
  const activityQ = mode === "admin" ? adminActivityQ : tenantActivityQ;
  const s = statsQ.data;
  const a = activityQ.data;

  return (
    <MarketingShell subtitle={t("marketing.overview.subtitle", lang)}>
      {/* Top metric strip — totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Metric label={t("marketing.overview.contacts", lang)} value={s?.contacts?.total ?? "—"} icon={Users} />
        <Metric label={t("marketing.overview.subscribed", lang)} value={s?.contacts?.subscribed ?? "—"} icon={Activity} tone="good" />
        <Metric label={t("marketing.overview.segments", lang)} value={s?.segments ?? "—"} icon={Megaphone} />
        <Metric
          label={t("marketing.overview.campaigns", lang)}
          value={Object.values(s?.campaigns ?? {}).reduce((acc: number, b: any) => acc + Number(b), 0) || "—"}
          icon={Mail}
        />
      </div>

      {/* 7-day activity strip — real data */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 mb-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("marketing.overview.activityTitle", lang)}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {t("marketing.overview.activityDescription", lang)}
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric
            label={t("marketing.overview.campaignsSent", lang)}
            value={a?.campaignsSent ?? "—"}
            icon={Send}
            tone="good"
          />
          <Metric
            label={t("marketing.overview.contactsAdded", lang)}
            value={a?.contactsAdded ?? "—"}
            icon={UserPlus}
          />
          <Metric
            label={t("marketing.overview.sendsFailed", lang)}
            value={a?.sendsFailed ?? "—"}
            icon={AlertTriangle}
            tone={a && a.sendsFailed > 0 ? "bad" : "default"}
          />
          <Metric
            label={t("marketing.overview.unsubscribes", lang)}
            value={a?.unsubscribes ?? "—"}
            icon={TrendingDown}
            tone={a && a.unsubscribes > 0 ? "warn" : "default"}
          />
        </div>
      </div>
    </MarketingShell>
  );
}
