interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonCard({ className = "" }: SkeletonProps) {
  return (
    <div className={`bg-white dark:bg-slate-800/70 border border-[#e5e7eb] dark:border-white/[0.07] rounded-xl p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-7 w-16" />
          <div className="skeleton h-3 w-20" />
        </div>
        <div className="skeleton w-11 h-11 rounded-xl" />
      </div>
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, cols = 4, className = "" }: SkeletonTableProps) {
  return (
    <div className={`bg-white dark:bg-slate-800/70 border border-[#e5e7eb] dark:border-white/[0.07] rounded-xl overflow-hidden ${className}`}>
      {/* Header row */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-[#e5e7eb] dark:border-white/[0.07]">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={`skeleton h-3 ${i === 0 ? "w-32" : "flex-1"}`} />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 px-4 py-3.5 border-b border-[#e5e7eb]/60 dark:border-white/[0.04] last:border-0"
        >
          <div className="skeleton h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3 w-32" />
            <div className="skeleton h-2.5 w-20" />
          </div>
          {Array.from({ length: cols - 2 }).map((_, i) => (
            <div key={i} className="skeleton h-3 flex-1 max-w-[80px]" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["w-full", "w-4/5", "w-2/3", "w-3/4", "w-1/2"];
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`skeleton h-3 ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}
