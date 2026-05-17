"use client";

/**
 * ReminderChip — thin colored bar rendered on the day/week calendar grid
 * at the fire time of a reminder/routine occurrence. Click → opens the
 * ReminderDetailPanel.
 *
 * Distinct visual register from AptCard (full-width status-tinted block)
 * AND from time-off / reservation hatched-grey blocks. A 4–6px tall
 * indigo (reminder) or emerald (routine) bar with a tiny bell glyph.
 * Width matches the master column.
 */

import { Bell, Repeat } from "lucide-react";

interface Props {
  reminderId: string;
  kind: "reminder" | "routine";
  title: string;
  firesAtTime: string; // HH:MM
  topPx: number;       // absolute Y inside the column
  onClick?: (reminderId: string) => void;
}

export function ReminderChip({ reminderId, kind, title, firesAtTime, topPx, onClick }: Props) {
  const Icon = kind === "routine" ? Repeat : Bell;
  const tone = kind === "routine"
    ? "bg-emerald-500/85 hover:bg-emerald-500 ring-emerald-300/40"
    : "bg-indigo-500/85 hover:bg-indigo-500 ring-indigo-300/40";

  return (
    <button
      type="button"
      data-testid={`reminder-chip-${reminderId}`}
      data-reminder-id={reminderId}
      onClick={() => onClick?.(reminderId)}
      title={`${firesAtTime} · ${title}`}
      className={`absolute left-1 right-1 h-[6px] rounded-full ${tone} ring-1 ring-inset shadow-sm flex items-center justify-start pl-1 group transition-all hover:h-5`}
      style={{ top: topPx, zIndex: 5 }}
    >
      <Icon className="h-2.5 w-2.5 text-white opacity-90 shrink-0" aria-hidden="true" />
      <span className="text-[10px] text-white font-medium ml-1 opacity-0 group-hover:opacity-100 transition-opacity truncate">
        {firesAtTime} · {title}
      </span>
    </button>
  );
}
