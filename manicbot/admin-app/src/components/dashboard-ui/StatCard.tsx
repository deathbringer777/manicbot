"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

export interface StatTrend {
  value: number;
  label?: string;
}

export function StatCard({ label, value, sub, icon: Icon, color, trend, sparkline }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
  trend?: StatTrend;
  sparkline?: number[];
}) {
  const trendUp = trend ? trend.value > 0 : false;
  const trendDown = trend ? trend.value < 0 : false;
  const trendTone = trendUp
    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/15"
    : trendDown
    ? "text-red-500 dark:text-red-400 bg-red-500/15"
    : "text-slate-500 dark:text-slate-400 bg-slate-500/10";
  const TrendIcon = trendUp ? TrendingUp : trendDown ? TrendingDown : null;

  return (
    <div className="group glass-card rounded-2xl p-4 relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-tight">{value}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
          {(sub || (trend && TrendIcon)) && (
            <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
              {trend && TrendIcon && (
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold tabular-nums ${trendTone}`}>
                  <TrendIcon className="h-2.5 w-2.5" />
                  {Math.abs(trend.value).toFixed(0)}%
                </span>
              )}
              {sub && <span className="text-[10px] text-slate-500 truncate">{sub}</span>}
            </div>
          )}
        </div>
      </div>
      {sparkline && sparkline.length >= 2 && (
        <div className="mt-2.5 -mx-1">
          <StatSparkline data={sparkline} trendUp={trendUp} trendDown={trendDown} />
        </div>
      )}
    </div>
  );
}

function StatSparkline({ data, trendUp, trendDown }: { data: number[]; trendUp: boolean; trendDown: boolean }) {
  const w = 140;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const points = data
    .map((d, i) => `${i * step},${h - ((d - min) / range) * (h - 4) - 2}`)
    .join(" ");
  const lastX = (data.length - 1) * step;
  const lastY = h - ((data[data.length - 1]! - min) / range) * (h - 4) - 2;
  const stroke = trendDown ? "var(--trend-down)" : trendUp ? "var(--trend-up)" : "var(--trend-flat)";
  const fillId = `stat-spark-fill-${trendDown ? "d" : trendUp ? "u" : "n"}`;

  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${h} ${points} ${lastX},${h}`} fill={`url(#${fillId})`} stroke="none" />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
      <circle cx={lastX} cy={lastY} r="4" fill={stroke} opacity="0.18" />
    </svg>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-slate-200 dark:bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-6 w-16 bg-slate-200 dark:bg-white/10 rounded" />
          <div className="h-3 w-24 bg-slate-200 dark:bg-white/10 rounded" />
        </div>
      </div>
    </div>
  );
}
