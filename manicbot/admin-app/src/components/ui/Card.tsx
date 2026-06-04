"use client";

export function Card({
  children,
  className = "",
  padding = "p-6",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  padding?: string;
  as?: React.ElementType;
}) {
  return (
    <Tag
      className={`rounded-xl border border-[#e5e7eb] dark:border-white/[0.06] bg-white dark:bg-slate-800 ${padding} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-[15px] font-semibold text-[#1a1a2e] dark:text-white">{title}</h2>
      {action && <div>{action}</div>}
    </div>
  );
}
