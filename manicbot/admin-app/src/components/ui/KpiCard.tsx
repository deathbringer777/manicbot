"use client";

import Link from "next/link";
import { ArrowUpRight, TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface KpiTrend {
  value: number;
  label?: string;
}

export function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  iconBg,
  iconColor,
  href,
  trend,
  sparkline,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  href?: string;
  trend?: KpiTrend;
  sparkline?: number[];
}) {
  const trendUp = trend ? trend.value > 0 : false;
  const trendDown = trend ? trend.value < 0 : false;
  const trendTone = trendUp
    ? "text-accent-600 dark:text-accent-400 bg-accent-500/10 dark:bg-accent-500/15"
    : trendDown
    ? "text-red-600 dark:text-red-400 bg-red-500/10 dark:bg-red-500/15"
    : "text-muted-foreground dark:text-slate-400 bg-surface-muted dark:bg-white/[0.06]";
  const TrendIcon = trendUp ? TrendingUp : trendDown ? TrendingDown : null;

  const inner = (
    <>
      <div className="flex items-start gap-4">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
        >
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground dark:text-slate-400">
              {label}
            </p>
            {href && (
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground dark:text-slate-600 opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 shrink-0" />
            )}
          </div>
          <p className="mt-0.5 text-[26px] font-bold leading-none text-foreground dark:text-white tabular-nums">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {trend && TrendIcon && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${trendTone}`}
              >
                <TrendIcon className="h-3 w-3" />
                {Math.abs(trend.value).toFixed(0)}%
                {trend.label && (
                  <span className="font-normal opacity-70 ml-0.5">{trend.label}</span>
                )}
              </span>
            )}
            {subtext && (
              <p className="text-[12px] text-muted-foreground dark:text-slate-500 truncate">{subtext}</p>
            )}
          </div>
        </div>
      </div>

      {sparkline && sparkline.length >= 2 && (
        <div className="mt-3 -mx-1">
          <Sparkline data={sparkline} trendUp={trendUp} trendDown={trendDown} />
        </div>
      )}
    </>
  );

  const base =
    "group relative rounded-xl border border-border dark:border-white/[0.06] bg-white dark:bg-slate-800 p-5 transition-all duration-200";

  if (href) {
    return (
      <Link
        href={href}
        className={`${base} block hover:border-accent-500/40 dark:hover:border-accent-500/30 hover:shadow-md hover:-translate-y-0.5`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

function Sparkline({ data, trendUp, trendDown }: { data: number[]; trendUp: boolean; trendDown: boolean }) {
  const w = 160;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data
    .map((d, i) => `${i * step},${h - ((d - min) / range) * (h - 4) - 2}`)
    .join(" ");
  const lastX = (data.length - 1) * step;
  const lastY = h - ((data[data.length - 1]! - min) / range) * (h - 4) - 2;

  const strokeId = `kpi-sparkline-stroke-${trendDown ? "down" : "up"}`;
  const fillId = `kpi-sparkline-fill-${trendDown ? "down" : "up"}`;
  const stroke = trendDown ? "var(--trend-down)" : trendUp ? "var(--trend-up)" : "var(--trend-flat)";

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,${h} ${points} ${lastX},${h}`}
        fill={`url(#${fillId})`}
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.5" fill={stroke} />
      <circle cx={lastX} cy={lastY} r="5" fill={stroke} opacity="0.18" />
    </svg>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border border-border dark:border-white/[0.06] bg-white dark:bg-slate-800 p-5">
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 shrink-0 rounded-xl skeleton-shimmer" />
        <div className="flex-1 space-y-2.5 pt-0.5">
          <div className="h-2.5 w-20 rounded skeleton-shimmer" />
          <div className="h-7 w-14 rounded skeleton-shimmer" />
          <div className="h-2 w-24 rounded skeleton-shimmer" />
        </div>
      </div>
    </div>
  );
}
