"use client";

/**
 * Pill / Badge primitive — tone × variant API, paired light + dark classes.
 *
 * Replaces ad-hoc STATUS_STYLES maps that historically used `text-{c}-400`
 * on `bg-{c}-500/20` without a `dark:` prefix — invisible in light mode.
 *
 * Sets data-tone / data-variant so theme-matrix tests can assert primitive usage.
 */

import type { HTMLAttributes, ReactNode } from "react";

export type PillTone =
  | "brand"
  | "accent"
  | "emerald"
  | "amber"
  | "red"
  | "violet"
  | "sky"
  | "slate"
  | "neutral";

export type PillVariant = "soft" | "solid" | "outline";

export type PillSize = "xs" | "sm" | "md";

const SIZE_CLASSES: Record<PillSize, string> = {
  xs: "text-[10px] px-1.5 py-0.5 gap-1 font-semibold",
  sm: "text-xs px-2 py-0.5 gap-1 font-semibold",
  md: "text-sm px-2.5 py-1 gap-1.5 font-medium",
};

const SOFT: Record<PillTone, string> = {
  brand:
    "bg-brand-100 text-brand-800 border border-brand-200 " +
    "dark:bg-brand-500/20 dark:text-brand-200 dark:border-brand-500/30",
  accent:
    "bg-accent-100 text-accent-800 border border-accent-200 " +
    "dark:bg-accent-500/20 dark:text-accent-200 dark:border-accent-500/30",
  emerald:
    "bg-emerald-100 text-emerald-800 border border-emerald-200 " +
    "dark:bg-emerald-500/20 dark:text-emerald-200 dark:border-emerald-500/30",
  amber:
    "bg-amber-100 text-amber-800 border border-amber-200 " +
    "dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/30",
  red:
    "bg-red-100 text-red-800 border border-red-200 " +
    "dark:bg-red-500/20 dark:text-red-200 dark:border-red-500/30",
  violet:
    "bg-violet-100 text-violet-800 border border-violet-200 " +
    "dark:bg-violet-500/20 dark:text-violet-200 dark:border-violet-500/30",
  sky:
    "bg-sky-100 text-sky-800 border border-sky-200 " +
    "dark:bg-sky-500/20 dark:text-sky-200 dark:border-sky-500/30",
  slate:
    "bg-slate-200 text-slate-700 border border-slate-300 " +
    "dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600",
  neutral:
    "bg-slate-100 text-slate-600 border border-slate-200 " +
    "dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

const SOLID: Record<PillTone, string> = {
  brand: "bg-brand-600 text-white dark:bg-brand-500",
  accent: "bg-accent-600 text-white dark:bg-accent-500",
  emerald: "bg-emerald-600 text-white dark:bg-emerald-500",
  amber: "bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950",
  red: "bg-red-600 text-white dark:bg-red-500",
  violet: "bg-violet-600 text-white dark:bg-violet-500",
  sky: "bg-sky-600 text-white dark:bg-sky-500",
  slate: "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900",
  neutral: "bg-slate-900 text-white dark:bg-white dark:text-slate-900",
};

const OUTLINE: Record<PillTone, string> = {
  brand:
    "bg-transparent text-brand-700 border border-brand-300 " +
    "dark:text-brand-200 dark:border-brand-500/50",
  accent:
    "bg-transparent text-accent-800 border border-accent-300 " +
    "dark:text-accent-200 dark:border-accent-500/50",
  emerald:
    "bg-transparent text-emerald-700 border border-emerald-300 " +
    "dark:text-emerald-200 dark:border-emerald-500/50",
  amber:
    "bg-transparent text-amber-800 border border-amber-300 " +
    "dark:text-amber-200 dark:border-amber-500/50",
  red:
    "bg-transparent text-red-700 border border-red-300 " +
    "dark:text-red-200 dark:border-red-500/50",
  violet:
    "bg-transparent text-violet-700 border border-violet-300 " +
    "dark:text-violet-200 dark:border-violet-500/50",
  sky:
    "bg-transparent text-sky-700 border border-sky-300 " +
    "dark:text-sky-200 dark:border-sky-500/50",
  slate:
    "bg-transparent text-slate-700 border border-slate-300 " +
    "dark:text-slate-300 dark:border-slate-600",
  neutral:
    "bg-transparent text-slate-700 border border-slate-200 " +
    "dark:text-slate-300 dark:border-slate-700",
};

const VARIANT_MAP: Record<PillVariant, Record<PillTone, string>> = {
  soft: SOFT,
  solid: SOLID,
  outline: OUTLINE,
};

const BASE = "inline-flex items-center rounded-full whitespace-nowrap";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  variant?: PillVariant;
  size?: PillSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Pill({
  tone = "neutral",
  variant = "soft",
  size = "xs",
  leadingIcon,
  trailingIcon,
  className = "",
  children,
  ...rest
}: PillProps) {
  const cls = [BASE, SIZE_CLASSES[size], VARIANT_MAP[variant][tone], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      data-tone={tone}
      data-variant={variant}
      data-size={size}
      className={cls}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </span>
  );
}

export default Pill;
