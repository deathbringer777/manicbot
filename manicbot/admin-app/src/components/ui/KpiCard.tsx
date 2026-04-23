"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  iconBg,
  iconColor,
  href,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  href?: string;
}) {
  const inner = (
    <div className="flex items-start gap-4">
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}
      >
        <Icon className={`h-5 w-5 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b7280] dark:text-slate-400">
          {label}
        </p>
        <p className="mt-0.5 text-[26px] font-bold leading-none text-[#1a1a2e] dark:text-white tabular-nums">
          {typeof value === "number" ? value.toLocaleString() : value}
        </p>
        {subtext && (
          <p className="mt-1.5 text-[12px] text-[#6b7280] dark:text-slate-500">{subtext}</p>
        )}
      </div>
    </div>
  );

  const cls =
    "rounded-xl border border-[#e5e7eb] dark:border-white/[0.06] bg-white dark:bg-slate-800 p-5 transition-all duration-150";

  if (href) {
    return (
      <Link
        href={href}
        className={`${cls} block hover:border-accent-500/40 dark:hover:border-accent-500/30 hover:shadow-sm`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

export function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#e5e7eb] dark:border-white/[0.06] bg-white dark:bg-slate-800 p-5">
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
