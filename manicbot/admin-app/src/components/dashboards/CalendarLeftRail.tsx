"use client";

/**
 * CalendarLeftRail — Booksy / Google Calendar style left rail next to
 * Day / Week / Month / Agenda views.
 *
 *   ┌─ May 2026 ──── ‹ › ┐
 *   │ M T W T F S S      │
 *   │     1 2 3          │
 *   │ 4 5 6 7 8 9 ●10    │  ← today highlighted, click → jumps the view
 *   │ 11 …                │
 *   ├──────────────────  ┤
 *   │ Jump By Week        │
 *   │ +1 +2 +3 +4 +5 +6   │
 *   │ -1 -2 -3 -4 -5 -6   │
 *   └────────────────────┘
 *
 * Stateless — owns no date itself; reads `selectedDate` from props and
 * fires `setSelectedDate(d)` when the user clicks a day or a Jump-By-Week
 * chip. The day-grid views own the canonical date.
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";

interface Props {
  selectedDate: Date;
  setSelectedDate: (d: Date) => void;
  lang: Lang;
  /** Optional anchor month (defaults to selectedDate's month). */
  viewMonth?: Date;
  setViewMonth?: (d: Date) => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS_BY_LANG: Record<string, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  ua: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"],
};

export function CalendarLeftRail({
  selectedDate,
  setSelectedDate,
  lang,
  viewMonth: viewMonthProp,
  setViewMonth: setViewMonthProp,
}: Props) {
  const viewMonth = viewMonthProp ?? selectedDate;
  // Local month nav uses an internal callback if the parent didn't supply one.
  const setVm = setViewMonthProp ?? setSelectedDate;

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const todayIso = fmtIso(new Date());
  const selectedIso = fmtIso(selectedDate);

  const cells: (number | null)[] = useMemo(() => {
    const firstDowSun = new Date(year, month, 1).getDay();
    // Mon-anchored week — JS getDay returns 0=Sun, we want Mon=0.
    const firstDow = (firstDowSun + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const out: (number | null)[] = [
      ...Array<null>(firstDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month]);

  const monthLabel = viewMonth.toLocaleString(
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU",
    { month: "long", year: "numeric" },
  );
  const weekdays = WEEKDAYS_BY_LANG[lang] ?? WEEKDAYS_BY_LANG.ru!;

  const jumpWeeks = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta * 7);
    setSelectedDate(d);
  };

  const jumpDay = (day: number) => {
    const d = new Date(year, month, day);
    setSelectedDate(d);
  };

  const goPrevMonth = () => setVm(new Date(year, month - 1, 1));
  const goNextMonth = () => setVm(new Date(year, month + 1, 1));

  return (
    <aside
      data-testid="calendar-left-rail"
      className="hidden lg:flex flex-col gap-4 w-56 shrink-0"
    >
      {/* Mini month grid */}
      <section className="glass-card rounded-2xl p-3" data-testid="calendar-mini-month">
        <header className="flex items-center justify-between mb-2 px-1">
          <p className="text-xs font-bold text-slate-900 dark:text-white capitalize truncate">
            {monthLabel}
          </p>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={goPrevMonth}
              data-testid="mini-month-prev"
              aria-label={t("salon.day.prev", lang)}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={goNextMonth}
              data-testid="mini-month-next"
              aria-label={t("salon.day.next", lang)}
              className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-px mb-0.5">
          {weekdays.map((d) => (
            <div
              key={d}
              className="text-center text-[9px] font-medium uppercase text-slate-400 dark:text-slate-500"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-px">
          {cells.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} className="h-6" />;
            const iso = `${year}-${pad(month + 1)}-${pad(day)}`;
            const isToday = iso === todayIso;
            const isSelected = iso === selectedIso;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => jumpDay(day)}
                data-testid="mini-month-day"
                data-day={iso}
                data-today={isToday ? "1" : "0"}
                data-selected={isSelected ? "1" : "0"}
                className={`h-6 w-full rounded text-[10px] font-medium tabular-nums transition-colors ${
                  isSelected
                    ? "bg-brand-500 text-white"
                    : isToday
                      ? "bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-slate-200"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </section>

      {/* Jump By Week chips — Booksy-parity */}
      <section className="glass-card rounded-2xl p-3" data-testid="jump-by-week">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
          {t("salon.rail.jumpByWeek", lang)}
        </p>
        <div className="grid grid-cols-6 gap-1 mb-1.5">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <button
              key={`+${d}`}
              type="button"
              onClick={() => jumpWeeks(d)}
              data-testid="jump-week-chip"
              data-delta={d}
              className="h-7 rounded text-[10px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
            >
              +{d}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-1">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <button
              key={`-${d}`}
              type="button"
              onClick={() => jumpWeeks(-d)}
              data-testid="jump-week-chip"
              data-delta={-d}
              className="h-7 rounded text-[10px] font-bold tabular-nums text-rose-700 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
            >
              −{d}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
