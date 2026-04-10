"use client";

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
      {action}
    </div>
  );
}
