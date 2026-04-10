"use client";

export function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4 relative overflow-hidden">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
          {sub && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</p>}
        </div>
      </div>
    </div>
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
