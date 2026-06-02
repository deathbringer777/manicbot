"use client";

/**
 * CreateSlotPopover — the small Google-Calendar-style card shown when the
 * user drags/clicks an empty slot on the Day/Week grid. It replaces the old
 * behaviour where a stray drag immediately threw up the full-screen,
 * backdrop-blurred ManualBookingModal (the user's "фон не видно" complaint).
 *
 * The card keeps the calendar visible and offers two intents that mirror the
 * existing drag modifiers:
 *   - «Создать запись» → opens the full booking form (ManualBookingModal).
 *   - «Резерв времени» → opens the time-reservation dialog (hold a slot).
 *
 * Both routes call the parent's existing `onCreateAt`, so no booking logic
 * is duplicated here — this is purely the lightweight intercept layer.
 */

import { useState } from "react";
import { Clock, Plus, Lock, X } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { AnchoredPopover } from "~/components/calendar/AnchoredPopover";
import type { AnchorRect } from "~/lib/calendar/useAnchoredPosition";

interface Props {
  anchorRect: AnchorRect | null;
  /** ISO date YYYY-MM-DD of the slot. */
  date: string;
  /** Start time HH:MM. */
  time: string;
  durationMin: number;
  masterName?: string | null;
  lang: Lang;
  /** Create a client booking → opens the full ManualBookingModal. The typed
   *  title is carried in as the booking note. */
  onCreate: (title: string) => void;
  /** Hold the slot without a client → opens the reservation dialog with the
   *  typed title prefilled as the reason. */
  onReserve: (title: string) => void;
  onClose: () => void;
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + mins;
  const hh = Math.floor((total % (24 * 60)) / 60);
  const mm = total % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(hh)}:${pad(mm)}`;
}

export function CreateSlotPopover({
  anchorRect,
  date,
  time,
  durationMin,
  masterName,
  lang,
  onCreate,
  onReserve,
  onClose,
}: Props) {
  const locale =
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU";
  const dateLabel = (() => {
    try {
      return new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
    } catch {
      return date;
    }
  })();
  const endTime = addMinutes(time, durationMin);
  const [title, setTitle] = useState("");

  return (
    <AnchoredPopover
      anchorRect={anchorRect}
      onClose={onClose}
      width={300}
      heightEstimate={210}
      testId="create-slot-popover"
      ariaLabel={t("appointments.manual.title", lang)}
      className="p-4"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {t("appointments.manual.title", lang)}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-slate-600 dark:text-slate-300">
              <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="capitalize">{dateLabel}</span>
              <span className="tabular-nums">
                · {time}–{endTime}
              </span>
            </p>
            {masterName ? (
              <p className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-slate-400">
                {masterName}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label={t("common.close", lang)}
            data-testid="create-slot-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* GCal-style: type a title right here. It rides into whichever
            dialog opens (note for a booking, reason for a reservation). */}
        <input
          type="text"
          autoFocus
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCreate(title.trim());
            }
          }}
          placeholder={t("appointments.quickTitle", lang)}
          data-testid="create-slot-title"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 placeholder:text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-brand-400 dark:placeholder:text-white/30"
        />

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={() => onCreate(title.trim())}
            data-testid="create-slot-create"
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(209,70,56,0.45)] transition hover:opacity-90"
            style={{ background: "linear-gradient(135deg,var(--color-primary),var(--color-secondary))" }}
          >
            <Plus className="h-4 w-4" />
            {t("appointments.manual.create", lang)}
          </button>
          <button
            type="button"
            onClick={() => onReserve(title.trim())}
            data-testid="create-slot-reserve"
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:bg-white/[0.08]"
          >
            <Lock className="h-3.5 w-3.5" />
            {t("salon.fab.timeReservation", lang)}
          </button>
        </div>
      </div>
    </AnchoredPopover>
  );
}
