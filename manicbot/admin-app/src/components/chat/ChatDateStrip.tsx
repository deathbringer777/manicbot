"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLang } from "~/components/LangContext";
import type { ChatButton } from "./chatTypes";
import { parseDateKeyboard } from "./chatKeyboards";

/**
 * Renders the bot's calendar keyboard (`dt:`/`cm:` callbacks) as a horizontal,
 * swipeable strip of day cards instead of a raw column of number buttons.
 *
 * It stays driven by the keyboard the Worker sent: each day card carries the
 * original `dt:YYYY-MM-DD` callback, the month chevrons carry the `cm:` nav
 * callbacks. Tapping a chevron makes the bot edit this bubble in place with the
 * next month, so the strip just re-renders.
 */
export function ChatDateStrip({
  rows,
  brandColor = "#EC4899",
  onPick,
}: {
  rows: ChatButton[][];
  brandColor?: string;
  onPick: (callbackData: string) => void;
}) {
  const { lang } = useLang();
  const { days, prevMonth, nextMonth, footer } = useMemo(
    () => parseDateKeyboard(rows),
    [rows],
  );
  // Transient highlight while the bot advances to time selection.
  const [pendingIso, setPendingIso] = useState<string | null>(null);

  const monthLabel = useMemo(() => {
    const first = days[0]?.iso;
    if (!first) return "";
    const [y, m, d] = first.split("-").map(Number);
    const label = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(
      new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1),
    );
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [days, lang]);

  function weekday(iso: string): string {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat(lang, { weekday: "short" })
      .format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1))
      .replace(/\.$/, "");
  }

  function pickDay(d: { iso: string; callbackData: string }) {
    setPendingIso(d.iso);
    onPick(d.callbackData);
  }

  if (!days.length) return null;

  return (
    <div className="space-y-1.5">
      {monthLabel && (
        <div className="px-1 text-center text-[11px] font-medium text-slate-400 dark:text-slate-500">
          {monthLabel}
        </div>
      )}

      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {prevMonth?.callback_data && (
          <button
            type="button"
            aria-label="Предыдущий месяц"
            onClick={() => onPick(prevMonth.callback_data!)}
            className="flex h-[3.25rem] w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition active:scale-95 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {days.map((d) => {
          const selected = pendingIso === d.iso;
          const accent = selected || d.isToday;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => pickDay(d)}
              className="flex h-[3.25rem] w-[3.25rem] shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-2xl border text-center transition active:scale-95"
              style={
                selected
                  ? { background: brandColor, borderColor: brandColor, color: "#fff" }
                  : d.isToday
                    ? { borderColor: `${brandColor}66`, color: brandColor, background: `${brandColor}0d` }
                    : undefined
              }
            >
              <span
                className={`text-[10px] uppercase leading-none tracking-wide ${
                  accent ? "" : "text-slate-400 dark:text-slate-500"
                }`}
                style={accent && !selected ? { color: brandColor } : undefined}
              >
                {weekday(d.iso)}
              </span>
              <span
                className={`text-lg font-semibold leading-none tabular-nums ${
                  accent ? "" : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {d.day}
              </span>
            </button>
          );
        })}

        {nextMonth?.callback_data && (
          <button
            type="button"
            aria-label="Следующий месяц"
            onClick={() => onPick(nextMonth.callback_data!)}
            className="flex h-[3.25rem] w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition active:scale-95 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {footer?.callback_data && (
        <button
          type="button"
          onClick={() => onPick(footer.callback_data!)}
          className="w-full pt-0.5 text-center text-xs text-slate-400 underline-offset-2 transition hover:text-slate-600 hover:underline dark:text-slate-500 dark:hover:text-slate-300"
        >
          {footer.text}
        </button>
      )}
    </div>
  );
}
