"use client";

/**
 * CalendarViewSwitcher — Google Calendar–parity dropdown for picking
 * between Day / Week / Month / List. Replaces the inline 5-pill bar
 * (День / Неделя / Календарь / Агенда / Список) that lived inside
 * AppointmentsPageClient and SalonDashboard.
 *
 * Why a dropdown:
 *   * Mirrors the GCal pattern the user explicitly asked to copy
 *     (see Calendar Overhaul plan, §3 / screenshots in PR description).
 *   * Drops «Агенда» from the surface — the user said «никто не знает
 *     слова АГЕНДА». The agenda renderer is reused for `list` mode.
 *   * Frees ~250 px of horizontal space on the appointments header,
 *     letting the page title breathe and removing the duplicate H2.
 *
 * Keyboard shortcuts match GCal (D/W/M/A/X) when the dropdown is open;
 * a visible hint is rendered next to each row.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Columns3, CalendarRange, List, type LucideIcon } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

export type CalendarViewMode = "day" | "week" | "calendar" | "list";

interface Option {
  mode: CalendarViewMode;
  icon: LucideIcon;
  label: string;
  shortcut: string;
}

interface Props {
  mode: CalendarViewMode;
  setMode: (m: CalendarViewMode) => void;
  lang: Lang;
  /** Optional test-id suffix so two switchers on one page (unlikely but
   *  possible) don't collide on `data-testid`. */
  testIdPrefix?: string;
}

export function CalendarViewSwitcher({ mode, setMode, lang, testIdPrefix = "apt" }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape, mirroring QuickAddFab's pattern.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // GCal-style single-letter shortcuts. Active only while menu is open
      // to avoid stealing keystrokes from form inputs elsewhere on the page.
      const k = e.key.toLowerCase();
      if (k === "d") { setMode("day"); setOpen(false); }
      else if (k === "w") { setMode("week"); setOpen(false); }
      else if (k === "m") { setMode("calendar"); setOpen(false); }
      else if (k === "l" || k === "a" || k === "x") { setMode("list"); setOpen(false); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setMode]);

  const options: Option[] = [
    { mode: "day",      icon: Columns3,      label: t("salon.cal.day", lang),       shortcut: "D" },
    { mode: "week",     icon: CalendarRange, label: t("salon.cal.week", lang),      shortcut: "W" },
    { mode: "calendar", icon: CalendarDays,  label: t("salon.cal.calendar", lang),  shortcut: "M" },
    { mode: "list",     icon: List,          label: t("salon.cal.list", lang),      shortcut: "L" },
  ];
  const current = options.find((o) => o.mode === mode) ?? options[1]!;
  const CurrentIcon = current.icon;

  return (
    <div ref={wrapRef} className="relative" data-testid={`${testIdPrefix}-view-switcher`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={`${testIdPrefix}-view-switcher-trigger`}
        data-current={mode}
        data-open={open ? "1" : "0"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold text-brand-700 dark:text-brand-300 bg-brand-500/10 dark:bg-brand-500/15 hover:bg-brand-500/20 dark:hover:bg-brand-500/25 transition-all shadow-sm"
      >
        <CurrentIcon className="w-4 h-4 text-brand-600 dark:text-brand-300" />
        <span>{current.label}</span>
        <ChevronDown
          className={`w-4 h-4 text-brand-500 dark:text-brand-300 transition-transform duration-150 ${
            open ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          data-testid={`${testIdPrefix}-view-switcher-menu`}
          className="absolute right-0 top-full mt-1.5 z-30 w-52 origin-top-right rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl shadow-black/20 dark:shadow-black/60 overflow-hidden animate-[csw-fade-in_120ms_ease-out]"
        >
          <ul className="py-1">
            {options.map((o) => {
              const Icon = o.icon;
              const isActive = o.mode === mode;
              return (
                <li key={o.mode}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => { setMode(o.mode); setOpen(false); }}
                    data-testid={`${testIdPrefix}-view-switcher-option-${o.mode}`}
                    data-active={isActive ? "1" : "0"}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-brand-500/10 text-brand-700 dark:text-brand-300"
                        : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${
                      isActive ? "bg-brand-500/20 text-brand-600 dark:text-brand-300" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                    }`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1 text-xs font-medium">{o.label}</span>
                    <span
                      aria-hidden
                      className="text-[10px] font-mono font-semibold text-slate-400 dark:text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03]"
                    >
                      {o.shortcut}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Inline keyframe so we don't depend on a global Tailwind config
          edit. Dropdown fades + slides 4px down as it opens. */}
      <style jsx>{`
        @keyframes csw-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Normalize legacy view-mode values (`agenda` from before the calendar
 * overhaul) into the current 4-mode set. Used by callers that read
 * persisted state (URL params, localStorage) so a stale "agenda" key
 * doesn't blank the page.
 */
export function normalizeViewMode(raw: string | undefined | null): CalendarViewMode {
  if (raw === "day" || raw === "week" || raw === "calendar" || raw === "list") return raw;
  if (raw === "agenda") return "list"; // merged in 2026-05-16 calendar overhaul
  return "week"; // new default — was "day" before the overhaul
}
