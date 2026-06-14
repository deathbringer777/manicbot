import type { ReactNode } from "react";

/**
 * Horizontal-scroll wrapper for wide data tables on small screens.
 *
 * Desktop is unaffected — a table that already fits just renders. On a phone the
 * table scrolls sideways with momentum, and a right-edge fade hints there's more
 * content off-screen (the #1 reason users miss columns is they don't realise a
 * table scrolls). The fade is mobile-only (`sm:hidden`) and a11y-hidden.
 *
 * Use this instead of a bare `<table>` (or a hand-rolled `overflow-x-auto`)
 * wherever a table has enough columns to exceed a ~375px viewport. For the
 * highest-traffic lists (contacts, customers) prefer a real card-stack on
 * mobile; this primitive is the lower-effort scroll fallback for the dense
 * admin grids where a card view isn't worth the churn.
 */
export function ResponsiveTable({
  children,
  className = "",
  minWidthClass = "min-w-[40rem]",
  fadeFromClass = "from-[var(--background)]",
}: {
  children: ReactNode;
  className?: string;
  /** Tailwind min-width applied to the inner track so columns don't crush. */
  minWidthClass?: string;
  /** Gradient start color of the right-edge fade — set to match the surface the
   *  table sits on (e.g. `from-white dark:from-slate-900` inside a card). */
  fadeFromClass?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div className="overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
        <div className={minWidthClass}>{children}</div>
      </div>
      {/* Right-edge scroll affordance. Fades to the surface color so it blends
          in both themes. Hidden on >=sm where the table fits without scrolling. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l ${fadeFromClass} to-transparent sm:hidden`}
      />
    </div>
  );
}
