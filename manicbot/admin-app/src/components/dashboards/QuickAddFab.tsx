"use client";

/**
 * QuickAddFab — floating bottom-right action button for the appointments
 * tab. Three-action menu (calendar overhaul, 2026-05-16):
 *
 *   ┌─────────────────────────────┐
 *   │ + Новая запись              │  → opens NewBookingDialog (existing
 *   │                                  ManualBookingModal)
 *   │ ⏸  Резерв времени           │  → opens TimeReservationDialog
 *   │ ☕ Перерыв / выходной        │  → opens TimeOffDialog
 *   └─────────────────────────────┘
 *
 * All three actions are now wired to real backend flows (the secondary
 * two used to render `СКОРО` placeholders before migration 0061 added
 * `appointment_blocks`). If a parent forgets to wire `onTimeReservation`
 * or `onTimeOff` we keep the row enabled but no-op the click — the FAB
 * will surface the bug visually instead of pretending the feature isn't
 * shipped.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, X, Coffee, PauseCircle, type LucideIcon } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

interface Action {
  id: "newBooking" | "timeReservation" | "timeOff";
  icon: LucideIcon;
  label: string;
  description: string;
}

interface Props {
  lang: Lang;
  onNewBooking: () => void;
  onTimeReservation?: () => void;
  onTimeOff?: () => void;
}

export function QuickAddFab({ lang, onNewBooking, onTimeReservation, onTimeOff }: Props) {
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
    setOpen(false);
    if (a.id === "newBooking") onNewBooking();
    else if (a.id === "timeReservation") onTimeReservation?.();
    else if (a.id === "timeOff") onTimeOff?.();
  };

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
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => handleClick(a)}
                    data-testid={`quick-add-${a.id}`}
                    className="w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500 dark:text-brand-400 shrink-0">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white block">
                        {a.label}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                        {a.description}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
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
        className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-[0_12px_40px_-8px_rgba(124,58,237,0.55)] transition hover:scale-105 active:scale-95 sm:h-auto sm:w-auto sm:px-5 sm:py-3 sm:text-sm sm:font-semibold"
        style={{ background: "linear-gradient(135deg,#7c3aed,#06b6d4)" }}
        aria-label={t("salon.fab.title", lang)}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6 sm:hidden" /> : <Plus className="h-6 w-6 sm:hidden" />}
        <span className="hidden sm:inline">+ {t("appointments.newBooking", lang)}</span>
      </button>
    </div>
  );
}
