"use client";

import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

export interface SettingsHeaderStripProps {
  icon: LucideIcon;
  iconClass?: string;
  /** Primary line — main identity (email, salon name, plan). Always visible. */
  title: string;
  /** Secondary line — smaller, can carry context (role, slug, status text). */
  subtitle?: ReactNode;
  /** Right-side slot for status badges. Non-interactive area. */
  rightSlot?: ReactNode;
}

/**
 * Compact, read-only header strip used at the top of each Settings section.
 * Shows who/what at a glance + status badges; never carries CTAs (those live
 * in the CollapsibleSections below).
 *
 * Intentionally a `<div>`, not a `<button>` — the strip itself is not
 * interactive. Clickable status pills can be passed via `rightSlot`.
 */
export function SettingsHeaderStrip({
  icon: Icon,
  iconClass = "text-brand-400",
  title,
  subtitle,
  rightSlot,
}: SettingsHeaderStripProps) {
  return (
    <section
      data-testid="settings-header-strip"
      className="glass-card rounded-2xl p-3 flex items-center gap-3"
    >
      <Icon className={`w-5 h-5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
          {title}
        </p>
        {subtitle && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {subtitle}
          </div>
        )}
      </div>
      {rightSlot && <div className="shrink-0 flex items-center gap-1.5">{rightSlot}</div>}
    </section>
  );
}
