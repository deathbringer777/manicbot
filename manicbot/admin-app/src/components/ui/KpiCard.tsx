import type { LucideIcon } from "lucide-react";
import Link from "next/link";

interface KpiCardProps {
  metric: string | number;
  label: string;
  sublabel?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: { value: number; label?: string };
  href?: string;
  accent?: "green" | "cyan" | "amber" | "pink" | "blue" | "violet";
}

const accentMap: Record<NonNullable<KpiCardProps["accent"]>, { iconBg: string; iconColor: string; bar: string }> = {
  green:  { iconBg: "bg-brand-500/10 dark:bg-brand-500/15", iconColor: "text-brand-600 dark:text-brand-400", bar: "from-brand-500/70 to-transparent" },
  cyan:   { iconBg: "bg-cyan-500/10 dark:bg-cyan-500/15",   iconColor: "text-cyan-600 dark:text-cyan-400",   bar: "from-cyan-500/70 to-transparent" },
  amber:  { iconBg: "bg-amber-500/10 dark:bg-amber-500/15", iconColor: "text-amber-600 dark:text-amber-400", bar: "from-amber-500/70 to-transparent" },
  pink:   { iconBg: "bg-pink-500/10 dark:bg-pink-500/15",   iconColor: "text-pink-600 dark:text-pink-400",   bar: "from-pink-500/70 to-transparent" },
  blue:   { iconBg: "bg-blue-500/10 dark:bg-blue-500/15",   iconColor: "text-blue-600 dark:text-blue-400",   bar: "from-blue-500/70 to-transparent" },
  violet: { iconBg: "bg-violet-500/10 dark:bg-violet-500/15", iconColor: "text-violet-600 dark:text-violet-400", bar: "from-violet-500/70 to-transparent" },
};

function TrendArrow({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-brand-600 dark:text-brand-400" : "text-red-500"}`}>
      <span>{up ? "↑" : "↓"}</span>
      {Math.abs(value)}%
    </span>
  );
}

function Inner({ metric, label, sublabel, icon: Icon, iconColor, iconBg, trend, accent = "green" }: Omit<KpiCardProps, "href">) {
  const colors = accentMap[accent];
  const finalIconBg = iconBg ?? colors.iconBg;
  const finalIconColor = iconColor ?? colors.iconColor;

  return (
    <>
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${colors.bar}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#6b7280] dark:text-slate-400 truncate">
            {label}
          </p>
          <p className="text-3xl font-bold text-[#1a1a2e] dark:text-white mt-1.5 tracking-tight leading-none">
            {typeof metric === "number" ? metric.toLocaleString() : metric}
          </p>
          {(sublabel ?? trend) && (
            <div className="flex items-center gap-2 mt-1.5">
              {trend && <TrendArrow value={trend.value} />}
              {sublabel && (
                <span className="text-[11px] text-[#6b7280] dark:text-slate-500">{sublabel}</span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${finalIconBg}`}>
            <Icon className={`w-5 h-5 ${finalIconColor}`} />
          </div>
        )}
      </div>
    </>
  );
}

export function KpiCard(props: KpiCardProps) {
  const base =
    "relative overflow-hidden bg-white dark:bg-slate-800/70 border border-[#e5e7eb] dark:border-white/[0.07] rounded-xl p-6 shadow-[0_1px_4px_0_rgba(0,0,0,0.04)] dark:shadow-[0_4px_16px_0_rgba(0,0,0,0.2)]";

  if (props.href) {
    return (
      <Link href={props.href} className={`${base} block hover:border-brand-500/30 hover:shadow-[0_2px_12px_0_rgba(11,155,107,0.08)] transition-all duration-150`}>
        <Inner {...props} />
      </Link>
    );
  }
  return (
    <div className={base}>
      <Inner {...props} />
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="relative overflow-hidden bg-white dark:bg-slate-800/70 border border-[#e5e7eb] dark:border-white/[0.07] rounded-xl p-6">
      <div className="absolute inset-x-0 top-0 h-[2px] skeleton" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-8 w-16" />
          <div className="skeleton h-3 w-20" />
        </div>
        <div className="skeleton w-11 h-11 rounded-xl" />
      </div>
    </div>
  );
}
