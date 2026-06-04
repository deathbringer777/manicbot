"use client";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[32px] font-bold leading-tight tracking-tight text-[#1a1a2e] dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[14px] text-[#6b7280] dark:text-slate-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="shrink-0 pt-1">{actions}</div>}
    </div>
  );
}
