"use client";

import Link from "next/link";
import { AlertOctagon, AlertCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "~/trpc/react";

/**
 * Compact God Mode home widget that surfaces the last-24h error counts
 * (fatal / error / warning) and links to the full /errors page. Polls
 * every 30s. Hidden when the errorEvents router is unavailable — e.g.
 * the table is missing during the rollout window — so it never blocks
 * the dashboard.
 */
export function ErrorStatsWidget() {
  const { data, isError } = api.errorEvents.stats.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
  });

  if (isError) return null;

  const fatal = data?.last24h.fatal ?? 0;
  const error = data?.last24h.error ?? 0;
  const warning = data?.last24h.warning ?? 0;
  const total = data?.last24h.total ?? 0;

  const tone =
    fatal > 0
      ? "border-red-500/30 bg-red-500/[0.04]"
      : error > 0
        ? "border-orange-500/30 bg-orange-500/[0.04]"
        : warning > 0
          ? "border-amber-500/30 bg-amber-500/[0.04]"
          : "border-slate-200 dark:border-slate-800/50";

  return (
    <Link
      href="/errors"
      className={`group block rounded-2xl border ${tone} p-4 transition-colors hover:bg-white/[0.03]`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
            Errors (24h)
          </span>
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Total" value={total} tone="neutral" />
        <Stat label="Fatal" value={fatal} tone="red" />
        <Stat label="Error" value={error} tone="orange" />
        <Stat label="Warn" value={warning} tone="amber" />
      </div>
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "red" | "orange" | "amber";
}) {
  const color =
    tone === "red"
      ? value > 0
        ? "text-red-400"
        : "text-slate-500"
      : tone === "orange"
        ? value > 0
          ? "text-orange-400"
          : "text-slate-500"
        : tone === "amber"
          ? value > 0
            ? "text-amber-400"
            : "text-slate-500"
          : "text-slate-700 dark:text-slate-200";
  const Icon =
    tone === "red"
      ? AlertOctagon
      : tone === "orange"
        ? AlertCircle
        : tone === "amber"
          ? AlertTriangle
          : null;
  return (
    <div className="text-center">
      <div className={`text-xl font-bold ${color} tabular-nums`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center justify-center gap-1">
        {Icon && <Icon className="w-2.5 h-2.5" />}
        {label}
      </div>
    </div>
  );
}
