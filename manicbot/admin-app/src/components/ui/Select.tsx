"use client";

/**
 * CustomSelect — brand-styled replacement for native <select>.
 *
 * Native <select> dropdowns render at the OS layer, ignore page
 * theming, and look out of place inside our glass-card modals
 * (slate borders, white panel, dark text on white). This component
 * renders the popover inside the React tree with the same colors,
 * radii, and motion as CalendarViewSwitcher, so dropdowns are
 * visually consistent across booking dialogs and never escape the
 * z-index of the modal that contains them.
 *
 * API mirrors a controlled `<select>` for one-line swaps:
 *   <Select value={v} onChange={setV} options={[{ value, label, sublabel? }]} />
 *
 * - Click trigger to toggle.
 * - Escape / outside click closes.
 * - ArrowDown / ArrowUp moves the keyboard cursor through options.
 * - Enter selects the focused option.
 * - Home / End jump to first / last option.
 * - Optional `sublabel` shown on the right of each row (used for
 *   "60 min · 100 zł" style metadata).
 * - `placeholder` shows when value is empty.
 * - `disabled` greys out the trigger and blocks interaction.
 * - `testIdPrefix` keeps multiple selects on one page distinguishable.
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  /** Optional second line / right-aligned metadata (e.g. duration · price). */
  sublabel?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Falls back to "select" if omitted; keeps test ids namespaced. */
  testIdPrefix?: string;
  /** Optional explicit width override — useful inside cramped 2-col grids. */
  className?: string;
}

const TRIGGER_BASE =
  "w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-slate-900 outline-none transition focus:border-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400";

const TRIGGER_DISABLED = "opacity-60 cursor-not-allowed";
const TRIGGER_ENABLED = "hover:border-slate-300 dark:hover:border-white/20 cursor-pointer";

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  testIdPrefix = "select",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  // Keyboard-cursor index — -1 means no keyboard focus yet.
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Sync focusIdx to the current value whenever the menu opens.
  useEffect(() => {
    if (!open) { setFocusIdx(-1); return; }
    const idx = options.findIndex((o) => o.value === value);
    setFocusIdx(idx >= 0 ? idx : 0);
  }, [open, value, options]);

  // Scroll focused option into view.
  useEffect(() => {
    if (!open || focusIdx < 0) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[focusIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, focusIdx]);

  // Outside-click and document-level Escape so the menu closes when the
  // user presses Escape while focus is anywhere in the document (mirrors
  // the original contract tested by Select.test.tsx). The button's own
  // onKeyDown also handles Escape for the focused-trigger case.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      // Open on common navigation keys while closed.
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, options.length - 1));
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        break;
      }
      case "Home": {
        e.preventDefault();
        setFocusIdx(0);
        break;
      }
      case "End": {
        e.preventDefault();
        setFocusIdx(options.length - 1);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (focusIdx >= 0 && focusIdx < options.length) {
          onChange(options[focusIdx]!.value);
          setOpen(false);
        }
        break;
      }
      case "Escape": {
        e.preventDefault();
        setOpen(false);
        break;
      }
      case "Tab": {
        // Close on tab-away so focus doesn't get stranded.
        setOpen(false);
        break;
      }
    }
  }

  const current = options.find((o) => o.value === value);
  const displayLabel = current?.label ?? placeholder ?? "";
  const hasValue = !!current;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`} data-testid={testIdPrefix}>
      <button
        type="button"
        disabled={!!disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        data-testid={`${testIdPrefix}-trigger`}
        data-open={open ? "1" : "0"}
        data-value={value || ""}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={
          open && focusIdx >= 0 ? `${testIdPrefix}-opt-${focusIdx}` : undefined
        }
        className={`${TRIGGER_BASE} text-sm ${disabled ? TRIGGER_DISABLED : TRIGGER_ENABLED}`}
      >
        <span className={`flex-1 truncate ${hasValue ? "" : "text-slate-400 dark:text-white/30"}`}>
          {displayLabel}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          data-testid={`${testIdPrefix}-menu`}
          className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-72 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl shadow-black/20 dark:shadow-black/60 animate-[select-fade-in_120ms_ease-out]"
        >
          <ul ref={listRef} className="py-1">
            {options.length === 0 && (
              <li className="px-3 py-2 text-xs text-slate-400 dark:text-white/40 text-center">
                {placeholder ?? "—"}
              </li>
            )}
            {options.map((o, idx) => {
              const isActive = o.value === value;
              const isFocused = idx === focusIdx;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    id={`${testIdPrefix}-opt-${idx}`}
                    role="option"
                    aria-selected={isActive}
                    data-testid={`${testIdPrefix}-option`}
                    data-value={o.value}
                    data-active={isActive ? "1" : "0"}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isFocused
                        ? "bg-brand-500/10 text-brand-700 dark:text-brand-300 outline-none"
                        : isActive
                          ? "bg-brand-500/10 text-brand-700 dark:text-brand-300"
                          : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.sublabel && (
                      <span className="text-[11px] text-slate-400 dark:text-white/40 shrink-0 tabular-nums">
                        {o.sublabel}
                      </span>
                    )}
                    {isActive && (
                      <Check className="h-3.5 w-3.5 text-brand-500 dark:text-brand-400 shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <style jsx>{`
        @keyframes select-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
