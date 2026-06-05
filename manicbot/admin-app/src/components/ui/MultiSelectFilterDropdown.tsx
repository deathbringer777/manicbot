"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface MultiSelectOption<K extends string> {
  value: K;
  label: string;
  testId?: string;
}

export interface MultiSelectFilterDropdownProps<K extends string> {
  /** Trigger label, e.g. "Filters". A `· N` active-count badge is appended. */
  label: string;
  options: MultiSelectOption<K>[];
  /** Which option keys are currently on. */
  selected: Record<K, boolean>;
  /** Toggle a single option. The popover stays open (independent toggles). */
  onToggle: (key: K) => void;
  /** Clear every option. */
  onReset: () => void;
  resetLabel: string;
  variant?: "brand" | "emerald";
  triggerTestId?: string;
  className?: string;
}

/**
 * Multi-toggle filter popover. Unlike the single-select `FilterDropdown`, the
 * panel stays open as the user flips independent toggles, shows an active-count
 * badge on the trigger, and offers a Reset. Reuses `FilterDropdown`'s surface,
 * trigger styling, and outside-click conventions so the dashboard stays
 * visually consistent.
 */
export function MultiSelectFilterDropdown<K extends string>({
  label,
  options,
  selected,
  onToggle,
  onReset,
  resetLabel,
  variant = "brand",
  triggerTestId,
  className,
}: MultiSelectFilterDropdownProps<K>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const activeCount = options.reduce((n, o) => (selected[o.value] ? n + 1 : n), 0);
  const hasValue = activeCount > 0;

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Outside-click + Escape close (mirrors FilterDropdown).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const triggerClass = hasValue
    ? variant === "brand"
      ? "bg-brand-500/10 text-brand-700 dark:text-brand-200 border-brand-500/40 focus:ring-brand-500/50"
      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 border-emerald-500/40 focus:ring-emerald-500/50"
    : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 focus:ring-brand-500/50";

  const menuTestId = triggerTestId?.replace("-trigger", "-menu");
  const resetTestId = triggerTestId ? `${triggerTestId.replace("-trigger", "")}-reset` : undefined;

  return (
    <div ref={containerRef} className={`relative${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 ${triggerClass}`}
      >
        <span className="truncate">
          {label}
          {hasValue && <span className="ml-1 tabular-nums font-semibold">· {activeCount}</span>}
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform${open ? " rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          id={menuId}
          data-testid={menuTestId}
          className="absolute left-0 top-full z-30 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg ring-1 ring-black/5 dark:border-white/10 dark:bg-slate-900 dark:ring-white/5"
        >
          {options.map((opt) => {
            const on = !!selected[opt.value];
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                data-testid={opt.testId}
                data-active={on ? "1" : "0"}
                onClick={() => onToggle(opt.value)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-white/5"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition ${
                    on
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-slate-300 dark:border-white/20"
                  }`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="truncate text-slate-700 dark:text-slate-200">{opt.label}</span>
              </button>
            );
          })}
          <div className="mt-1 border-t border-slate-100 px-1 pt-1 dark:border-white/5">
            <button
              type="button"
              onClick={onReset}
              disabled={!hasValue}
              data-testid={resetTestId}
              className="w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-white/5"
            >
              {resetLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
