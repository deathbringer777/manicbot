"use client";

import { useState, useEffect, useRef, useCallback, useId } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface FilterDropdownOption<V extends string> {
  value: V;
  label: string;
  testId?: string;
}

export interface FilterDropdownProps<V extends string> {
  label: string;
  options: FilterDropdownOption<V>[];
  value: V | null;
  onChange: (v: V | null) => void;
  allLabel: string;
  variant?: "brand" | "emerald";
  triggerTestId?: string;
  className?: string;
}

export function FilterDropdown<V extends string>({
  label,
  options,
  value,
  onChange,
  allLabel,
  variant = "brand",
  triggerTestId,
  className,
}: FilterDropdownProps<V>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // total = 1 ("Все") + options.length
  const totalItems = options.length + 1;

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    const idx = value === null ? 0 : options.findIndex((o) => o.value === value) + 1;
    setActiveIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  }, [value, options]);

  const selectIndex = useCallback(
    (idx: number) => {
      if (idx === 0) {
        onChange(null);
      } else {
        onChange(options[idx - 1]!.value);
      }
      close();
    },
    [onChange, options, close],
  );

  // Outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % totalItems);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) selectIndex(activeIndex);
    } else if (e.key === "Tab") {
      close();
    }
  };

  const hasValue = value !== null;
  const displayLabel =
    hasValue ? (options.find((o) => o.value === value)?.label ?? label) : label;

  const triggerClass =
    hasValue
      ? variant === "brand"
        ? "bg-brand-500/10 text-brand-700 dark:text-brand-200 border-brand-500/40 focus:ring-brand-500/50"
        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 border-emerald-500/40 focus:ring-emerald-500/50"
      : variant === "emerald"
        ? "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 focus:ring-emerald-500/50"
        : "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 focus:ring-brand-500/50";

  const menuTestId = triggerTestId?.replace("-trigger", "-menu");

  return (
    <div
      ref={containerRef}
      className={`relative${className ? ` ${className}` : ""}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid={triggerTestId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close() : openMenu())}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 ${triggerClass}`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform${open ? " rotate-180" : ""}`}
        />
      </button>

      <ul
        role="listbox"
        id={menuId}
        data-testid={menuTestId}
        aria-hidden={!open}
        className={`absolute left-0 top-full z-20 mt-1 max-h-72 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-white/10 dark:bg-slate-900${open ? "" : " hidden"}`}
      >
        <li
          role="option"
          aria-selected={value === null}
          data-active={activeIndex === 0 || undefined}
          onClick={() => selectIndex(0)}
          className={`flex cursor-pointer items-center justify-between px-3 py-1.5${
            activeIndex === 0
              ? " bg-slate-100 dark:bg-white/10"
              : " hover:bg-slate-50 dark:hover:bg-white/5"
          }`}
        >
          <span>{allLabel}</span>
          {value === null && <Check size={12} />}
        </li>

        {options.map((opt, i) => {
          const idx = i + 1;
          const isSelected = opt.value === value;
          return (
            <li
              key={opt.value}
              role="option"
              aria-selected={isSelected}
              data-testid={opt.testId}
              data-active={activeIndex === idx || undefined}
              onClick={() => selectIndex(idx)}
              className={`flex cursor-pointer items-center justify-between px-3 py-1.5${
                activeIndex === idx
                  ? " bg-slate-100 dark:bg-white/10"
                  : " hover:bg-slate-50 dark:hover:bg-white/5"
              }`}
            >
              <span>{opt.label}</span>
              {isSelected && <Check size={12} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
