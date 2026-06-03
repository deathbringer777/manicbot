"use client";

/** Single animated gray block — compose these to build loading layouts. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rounded skeleton-shimmer ${className}`} />;
}

/** Card-shaped skeleton with header icon + text lines. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-border dark:border-white/[0.06] bg-white dark:bg-slate-800 p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl skeleton-shimmer" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded skeleton-shimmer" />
          <div className="h-3 w-48 rounded skeleton-shimmer" />
        </div>
      </div>
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <div
          key={i}
          className={`mb-2 h-3 rounded skeleton-shimmer ${i === lines - 2 ? "w-3/4" : "w-full"}`}
        />
      ))}
    </div>
  );
}

/** Table-shaped skeleton with header row + data rows. */
export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border dark:border-white/[0.06] bg-white dark:bg-slate-800">
      {/* Header */}
      <div className="flex gap-4 border-b border-border dark:border-white/[0.06] px-5 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div
            key={i}
            className={`h-3 rounded skeleton-shimmer ${i === 0 ? "w-32" : "flex-1"}`}
          />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-border dark:border-white/[0.06] px-5 py-4 last:border-0"
        >
          <div className="h-8 w-8 shrink-0 rounded-full skeleton-shimmer" />
          {Array.from({ length: cols - 1 }).map((_, j) => (
            <div
              key={j}
              className={`h-3 rounded skeleton-shimmer ${j === 0 ? "w-40" : "flex-1"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
