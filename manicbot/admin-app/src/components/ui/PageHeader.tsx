import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className = "" }: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-6 ${className}`}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[#1a1a2e] dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-[#6b7280] dark:text-slate-400">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 pt-1">
          {actions}
        </div>
      )}
    </div>
  );
}
