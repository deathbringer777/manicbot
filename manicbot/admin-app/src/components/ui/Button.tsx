"use client";

/**
 * Button primitive — tone × variant API with explicit light AND dark mode classes.
 *
 * Why this exists: pale text shades like text-{c}-200 are designed for dark
 * backgrounds. Without a `dark:` prefix they apply to light theme too,
 * producing invisible "pale-on-pale" text (see HelpSection regression
 * 2026-05-16). Every variant below ships paired light + dark classes that
 * pass WCAG AA 4.5:1.
 *
 * Soft contrast contract (the one that broke):
 *   light: bg-{c}-50  text-{c}-700  border-{c}-200
 *   dark:  bg-{c}-500/15  text-{c}-200  border-{c}-500/35
 *
 * Sets data-tone / data-variant on the button so theme-matrix tests can
 * assert the primitive is in use without parsing className soup.
 */

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonTone =
  | "brand"
  | "accent"
  | "emerald"
  | "amber"
  | "red"
  | "violet"
  | "sky"
  | "slate"
  | "neutral";

export type ButtonVariant = "solid" | "soft" | "outline" | "ghost";

export type ButtonSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

// Soft variant — light bg + dark-readable text in BOTH themes.
const SOFT: Record<ButtonTone, string> = {
  brand:
    "bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100 " +
    "dark:bg-brand-500/15 dark:text-brand-200 dark:border-brand-500/35 dark:hover:bg-brand-500/25",
  accent:
    "bg-accent-50 text-accent-800 border border-accent-200 hover:bg-accent-100 " +
    "dark:bg-accent-500/15 dark:text-accent-200 dark:border-accent-500/35 dark:hover:bg-accent-500/25",
  emerald:
    "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 " +
    "dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/35 dark:hover:bg-emerald-500/25",
  amber:
    "bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 " +
    "dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/35 dark:hover:bg-amber-500/25",
  red:
    "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 " +
    "dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/35 dark:hover:bg-red-500/25",
  violet:
    "bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 " +
    "dark:bg-violet-500/15 dark:text-violet-200 dark:border-violet-500/35 dark:hover:bg-violet-500/25",
  sky:
    "bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 " +
    "dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/35 dark:hover:bg-sky-500/25",
  slate:
    "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 " +
    "dark:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600/60 dark:hover:bg-slate-700/60",
  neutral:
    "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 " +
    "dark:bg-slate-900/50 dark:text-slate-200 dark:border-slate-600/60 dark:hover:bg-slate-800",
};

// Solid variant — high-contrast call-to-action.
const SOLID: Record<ButtonTone, string> = {
  brand:
    "bg-brand-600 text-white border border-brand-700 hover:bg-brand-700 shadow-sm " +
    "dark:bg-brand-500 dark:border-brand-400 dark:hover:bg-brand-400",
  accent:
    "bg-accent-600 text-white border border-accent-700 hover:bg-accent-700 shadow-sm " +
    "dark:bg-accent-500 dark:border-accent-400 dark:hover:bg-accent-400",
  emerald:
    "bg-emerald-600 text-white border border-emerald-700 hover:bg-emerald-700 shadow-sm " +
    "dark:bg-emerald-500 dark:border-emerald-400 dark:hover:bg-emerald-400",
  amber:
    "bg-amber-500 text-white border border-amber-600 hover:bg-amber-600 shadow-sm " +
    "dark:bg-amber-400 dark:text-amber-950 dark:border-amber-300 dark:hover:bg-amber-300",
  red:
    "bg-red-600 text-white border border-red-700 hover:bg-red-700 shadow-sm " +
    "dark:bg-red-500 dark:border-red-400 dark:hover:bg-red-400",
  violet:
    "bg-violet-600 text-white border border-violet-700 hover:bg-violet-700 shadow-sm " +
    "dark:bg-violet-500 dark:border-violet-400 dark:hover:bg-violet-400",
  sky:
    "bg-sky-600 text-white border border-sky-700 hover:bg-sky-700 shadow-sm " +
    "dark:bg-sky-500 dark:border-sky-400 dark:hover:bg-sky-400",
  slate:
    "bg-slate-800 text-white border border-slate-900 hover:bg-slate-900 shadow-sm " +
    "dark:bg-slate-200 dark:text-slate-900 dark:border-slate-300 dark:hover:bg-white",
  neutral:
    "bg-slate-900 text-white border border-slate-900 hover:bg-slate-800 shadow-sm " +
    "dark:bg-white dark:text-slate-900 dark:border-slate-100 dark:hover:bg-slate-100",
};

// Outline variant — transparent bg, colored border, dark-readable text.
const OUTLINE: Record<ButtonTone, string> = {
  brand:
    "bg-transparent text-brand-700 border border-brand-300 hover:bg-brand-50 " +
    "dark:text-brand-200 dark:border-brand-500/50 dark:hover:bg-brand-500/15",
  accent:
    "bg-transparent text-accent-800 border border-accent-300 hover:bg-accent-50 " +
    "dark:text-accent-200 dark:border-accent-500/50 dark:hover:bg-accent-500/15",
  emerald:
    "bg-transparent text-emerald-700 border border-emerald-300 hover:bg-emerald-50 " +
    "dark:text-emerald-200 dark:border-emerald-500/50 dark:hover:bg-emerald-500/15",
  amber:
    "bg-transparent text-amber-800 border border-amber-300 hover:bg-amber-50 " +
    "dark:text-amber-200 dark:border-amber-500/50 dark:hover:bg-amber-500/15",
  red:
    "bg-transparent text-red-700 border border-red-300 hover:bg-red-50 " +
    "dark:text-red-200 dark:border-red-500/50 dark:hover:bg-red-500/15",
  violet:
    "bg-transparent text-violet-700 border border-violet-300 hover:bg-violet-50 " +
    "dark:text-violet-200 dark:border-violet-500/50 dark:hover:bg-violet-500/15",
  sky:
    "bg-transparent text-sky-700 border border-sky-300 hover:bg-sky-50 " +
    "dark:text-sky-200 dark:border-sky-500/50 dark:hover:bg-sky-500/15",
  slate:
    "bg-transparent text-slate-700 border border-slate-300 hover:bg-slate-50 " +
    "dark:text-slate-200 dark:border-slate-600 dark:hover:bg-slate-800/50",
  neutral:
    "bg-transparent text-slate-700 border border-slate-200 hover:bg-slate-50 " +
    "dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800/50",
};

// Ghost variant — no bg, no border, just colored text on hover-tint.
const GHOST: Record<ButtonTone, string> = {
  brand:
    "bg-transparent text-brand-700 hover:bg-brand-50 " +
    "dark:text-brand-200 dark:hover:bg-brand-500/15",
  accent:
    "bg-transparent text-accent-800 hover:bg-accent-50 " +
    "dark:text-accent-200 dark:hover:bg-accent-500/15",
  emerald:
    "bg-transparent text-emerald-700 hover:bg-emerald-50 " +
    "dark:text-emerald-200 dark:hover:bg-emerald-500/15",
  amber:
    "bg-transparent text-amber-800 hover:bg-amber-50 " +
    "dark:text-amber-200 dark:hover:bg-amber-500/15",
  red:
    "bg-transparent text-red-700 hover:bg-red-50 " +
    "dark:text-red-200 dark:hover:bg-red-500/15",
  violet:
    "bg-transparent text-violet-700 hover:bg-violet-50 " +
    "dark:text-violet-200 dark:hover:bg-violet-500/15",
  sky:
    "bg-transparent text-sky-700 hover:bg-sky-50 " +
    "dark:text-sky-200 dark:hover:bg-sky-500/15",
  slate:
    "bg-transparent text-slate-700 hover:bg-slate-100 " +
    "dark:text-slate-300 dark:hover:bg-slate-800/50",
  neutral:
    "bg-transparent text-slate-700 hover:bg-slate-100 " +
    "dark:text-slate-300 dark:hover:bg-slate-800/50",
};

const VARIANT_MAP: Record<ButtonVariant, Record<ButtonTone, string>> = {
  solid: SOLID,
  soft: SOFT,
  outline: OUTLINE,
  ghost: GHOST,
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium " +
  "transition-colors disabled:opacity-40 disabled:cursor-not-allowed " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = "brand",
    variant = "solid",
    size = "md",
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    className = "",
    children,
    ...rest
  },
  ref,
) {
  const cls = [
    BASE,
    SIZE_CLASSES[size],
    VARIANT_MAP[variant][tone],
    fullWidth ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      data-tone={tone}
      data-variant={variant}
      data-size={size}
      className={cls}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

export default Button;
