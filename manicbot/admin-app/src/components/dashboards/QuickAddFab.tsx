"use client";

/**
 * QuickAddFab — floating bottom-right action button.
 *
 * Mode `booking` (default — Overview / Appointments tabs):
 *   ┌─────────────────────────────┐
 *   │ + Новая запись              │  → onNewBooking
 *   │ ⏸  Резерв времени           │  → onTimeReservation
 *   │ ☕ Перерыв / выходной        │  → onTimeOff
 *   ├─────────────────────────────┤  ← separator when extraItems present
 *   │ … plugin-injected items …   │  → each .onClick
 *   └─────────────────────────────┘
 *
 * Mode `client` (0062 — Clients tab): single-action FAB. The menu sheet
 * is bypassed entirely — clicking the FAB fires `onAddClient` directly.
 * This addresses the UX bug where the salon owner could not create a
 * client without first creating an appointment.
 *
 * `extraItems` lets installed plugins inject menu rows declaratively (the
 * Reminders plugin adds "+ Reminder" / "+ Routine"). The FAB itself does
 * not know about plugins — the caller (SalonDashboard) queries
 * `plugins.getInstalled` and supplies the list.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, X, Coffee, PauseCircle, UserPlus, type LucideIcon } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

interface Action {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  disabled?: boolean;
  comingSoonCopy?: string;
  onClick?: () => void;
}

/**
 * Extra menu items injected by installed plugins. Rendered below the
 * built-in actions with a 1px separator. Each item is fully owned by the
 * caller — it brings its own icon, label, description and handler.
 */
export interface FabExtraItem {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}

export type QuickAddMode = "booking" | "client";

interface Props {
  lang: Lang;
  mode?: QuickAddMode;
  onNewBooking?: () => void;
  onTimeReservation?: () => void;
  onTimeOff?: () => void;
  onAddClient?: () => void;
  extraItems?: FabExtraItem[];
}

export function QuickAddFab({
  lang,
  mode = "booking",
  onNewBooking,
  onTimeReservation,
  onTimeOff,
  onAddClient,
  extraItems,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const actions: Action[] = [
    {
      id: "newBooking",
      icon: Plus,
      label: t("salon.fab.newBooking", lang),
      description: t("salon.fab.newBookingDesc", lang),
    },
    {
      id: "timeReservation",
      icon: PauseCircle,
      label: t("salon.fab.timeReservation", lang),
      description: t("salon.fab.timeReservationDesc", lang),
    },
    {
      id: "timeOff",
      icon: Coffee,
      label: t("salon.fab.timeOff", lang),
      description: t("salon.fab.timeOffDesc", lang),
    },
  ];

  const handleClick = (a: Action) => {
    if (a.disabled) return;
    setOpen(false);
    if (a.id === "newBooking") onNewBooking?.();
    else if (a.id === "timeReservation") onTimeReservation?.();
    else if (a.id === "timeOff") onTimeOff?.();
    else if (a.onClick) a.onClick();
  };

  const extraActions: Action[] = (extraItems ?? []).map((e) => ({
    id: e.id,
    icon: e.icon,
    label: e.label,
    description: e.description,
    onClick: e.onClick,
  }));

  // Clients-mode: short-circuit to single action — no menu, no toggle.
  if (mode === "client") {
    return (
      <div ref={containerRef} className="fixed bottom-24 right-4 z-40 sm:bottom-6 sm:right-6">
        <button
          type="button"
          onClick={() => onAddClient?.()}
          data-testid="quick-add-fab"
          data-mode="client"
          className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_12px_40px_-8px_rgba(209,70,56,0.55)] transition hover:scale-105 active:scale-95 sm:h-auto sm:w-auto sm:px-5 sm:py-3 sm:text-sm sm:font-semibold"
          style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" }}
          aria-label={t("clients.action.add", lang)}
        >
          <UserPlus className="h-6 w-6 sm:hidden" />
          <span className="hidden sm:inline">+ {t("clients.action.add", lang)}</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="fixed bottom-24 right-4 z-40 sm:bottom-6 sm:right-6">
      {/* Action sheet — desktop dropdown above the FAB, mobile bottom-sheet style */}
      {open && (
        <div
          data-testid="quick-add-menu"
          className="absolute bottom-16 right-0 mb-2 w-72 rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl shadow-black/30 dark:shadow-black/60 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-white/5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t("salon.fab.title", lang)}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="py-1">
            {actions.map((a) => renderActionRow(a, handleClick))}
            {extraActions.length > 0 && (
              <>
                <li className="my-1 border-t border-slate-100 dark:border-white/5" aria-hidden="true" />
                {extraActions.map((a) => renderActionRow(a, handleClick))}
              </>
            )}
          </ul>
        </div>
      )}

      {/* The FAB itself — same gradient + footprint as before so layout
          isn't disrupted; only behavior changes (single → menu trigger). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="quick-add-fab"
        data-open={open ? "1" : "0"}
        className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_12px_40px_-8px_rgba(209,70,56,0.55)] transition hover:scale-105 active:scale-95 sm:h-auto sm:w-auto sm:px-5 sm:py-3 sm:text-sm sm:font-semibold"
        style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" }}
        aria-label={t("salon.fab.title", lang)}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6 sm:hidden" /> : <Plus className="h-6 w-6 sm:hidden" />}
        <span className="hidden sm:inline">+ {t("appointments.newBooking", lang)}</span>
      </button>
    </div>
  );
}

function renderActionRow(a: Action, handleClick: (a: Action) => void) {
  const Icon = a.icon;
  const isDisabled = !!a.disabled;
  return (
    <li key={a.id}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => handleClick(a)}
        data-testid={`quick-add-${a.id}`}
        data-disabled={isDisabled ? "1" : "0"}
        className={`w-full text-left flex items-start gap-3 px-4 py-3 transition-colors ${
          isDisabled
            ? "opacity-60 cursor-not-allowed"
            : "hover:bg-slate-50 dark:hover:bg-white/[0.04]"
        }`}
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500 dark:text-brand-400 shrink-0">
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {a.label}
            </span>
            {isDisabled && a.comingSoonCopy && (
              <span className="text-[9px] uppercase tracking-wide font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-1.5 py-0.5">
                {a.comingSoonCopy}
              </span>
            )}
          </span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {a.description}
          </span>
        </span>
      </button>
    </li>
  );
}
