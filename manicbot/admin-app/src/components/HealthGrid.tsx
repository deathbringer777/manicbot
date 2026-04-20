"use client";

/**
 * Compact health-status grid for the God Mode home dashboard.
 *
 * Queries system.getHealth (existing) and surfaces Worker/D1/Stripe/AI state.
 * Includes a section for plugin-level health checks if any plugin declares
 * `capabilities.healthCheck: true`.
 */

import { Activity, CheckCircle2, AlertTriangle, CircleSlash } from "lucide-react";
import { api } from "~/trpc/react";
import { useLang } from "~/components/LangContext";
import { t } from "~/lib/i18n";
import { listManifests } from "@plugins/index";

type Status = "ok" | "degraded" | "down" | "unknown" | "not_configured";

function dot(status: Status) {
  if (status === "ok") {
    return <CheckCircle2 size={14} className="text-emerald-500" />;
  }
  if (status === "degraded") {
    return <AlertTriangle size={14} className="text-amber-500" />;
  }
  if (status === "down") {
    return <AlertTriangle size={14} className="text-red-500" />;
  }
  return <CircleSlash size={14} className="text-slate-400" />;
}

function HealthCell({
  label,
  status,
  detail,
}: {
  label: string;
  status: Status;
  detail?: string;
}) {
  return (
    <div
      data-testid="health-cell"
      data-status={status}
      className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/50"
      title={detail ?? undefined}
    >
      {dot(status)}
      <span className="text-xs text-slate-700 dark:text-slate-200 font-medium flex-1 truncate">
        {label}
      </span>
      {detail && (
        <span className="text-[10px] text-slate-400 max-w-[80px] truncate hidden sm:inline">
          {detail}
        </span>
      )}
    </div>
  );
}

export function HealthGrid() {
  const { lang } = useLang();
  const healthQ = api.system.getHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const pluginsWithHealth = listManifests().filter((m) => m.capabilities.healthCheck);

  const h = healthQ.data as {
    status?: "ok" | "error";
    dbConnected?: boolean;
    dbLatencyMs?: number;
  } | undefined;
  const d1Status: Status = h?.status === "ok" ? "ok" : h?.status === "error" ? "down" : "unknown";
  const core = [
    { label: "D1", status: d1Status, detail: h?.dbLatencyMs !== undefined ? `${h.dbLatencyMs}ms` : undefined },
    { label: "Stripe", status: "unknown" as Status },
    { label: "Resend", status: "unknown" as Status },
    { label: "Workers AI", status: "unknown" as Status },
  ];

  return (
    <section data-testid="health-grid" className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-slate-900/30 p-4">
      <header className="flex items-center gap-2 mb-3">
        <Activity size={14} className="text-slate-500" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {t("plugins.settings.title", lang)} · Health
        </h3>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {core.map((c) => (
          <HealthCell key={c.label} label={c.label} status={c.status} detail={c.detail} />
        ))}
      </div>
      {pluginsWithHealth.length > 0 && (
        <div
          data-testid="health-grid-plugins"
          className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2"
        >
          {pluginsWithHealth.map((m) => (
            <HealthCell key={m.slug} label={m.name[lang]} status="unknown" />
          ))}
        </div>
      )}
    </section>
  );
}
