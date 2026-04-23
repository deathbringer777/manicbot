"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick?: () => void; href?: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      {Icon && (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f3f4f6] dark:bg-slate-800/80">
          <Icon className="h-7 w-7 text-[#9ca3af] dark:text-slate-500" strokeWidth={1.5} />
        </div>
      )}
      <h3 className="text-[18px] font-bold text-[#1a1a2e] dark:text-white">{title}</h3>
      {description && (
        <p className="mt-2 max-w-[340px] text-[14px] leading-relaxed text-[#6b7280] dark:text-slate-400">
          {description}
        </p>
      )}
      {action && (
        action.href ? (
          <Link
            href={action.href}
            className="mt-6 inline-flex items-center rounded-full bg-[#1a1a2e] dark:bg-white px-5 py-2.5 text-[13px] font-semibold text-white dark:text-[#1a1a2e] transition-opacity hover:opacity-80"
          >
            {action.label}
          </Link>
        ) : (
          <button
            onClick={action.onClick}
            className="mt-6 inline-flex items-center rounded-full bg-[#1a1a2e] dark:bg-white px-5 py-2.5 text-[13px] font-semibold text-white dark:text-[#1a1a2e] transition-opacity hover:opacity-80"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
