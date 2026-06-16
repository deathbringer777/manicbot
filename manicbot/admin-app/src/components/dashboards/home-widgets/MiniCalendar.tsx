"use client";

/**
 * MiniCalendar — month-grid heatmap of daily appointment counts.
 *
 * Extracted verbatim from the god-mode `DashboardClient.tsx` so it can be
 * shared by the configurable salon home board's `calendar_heatmap` widget.
 * `DashboardClient.tsx` now imports this component instead of keeping an
 * inline copy. Behaviour is unchanged: a month grid where each day is tinted
 * by its booking density, today is highlighted, and the header lets the user
 * page between months / jump back to today.
 */

import { useState, useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "~/components/ui/Card";
import { t, localeFor, type Lang } from "~/lib/i18n";

const WEEKDAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function MiniCalendar({
  data,
  lang,
}: {
  data: { date: string; appointments: number }[];
  lang: Lang;
}) {
  const [viewDate, setViewDate] = useState(() => new Date());

  const dayMap = useMemo(() => {
    const m: Record<string, number> = {};
    data.forEach((d) => { m[d.date] = (m[d.date] ?? 0) + d.appointments; });
    return m;
  }, [data]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const fmtISO = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const monthLabel = viewDate.toLocaleString(localeFor(lang), { month: "long", year: "numeric" });
  const maxCount = Math.max(1, ...Object.values(dayMap));

  return (
    <Card padding="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-accent-500" />
          <h2 className="text-[13px] font-semibold text-[#1a1a2e] dark:text-white capitalize">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setViewDate(new Date(year, month - 1))}
            className="p-1.5 rounded-lg text-[#9ca3af] dark:text-slate-400 hover:text-[#374151] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewDate(new Date())}
            className="px-2 py-0.5 rounded-lg text-[10px] font-medium text-[#9ca3af] dark:text-slate-400 hover:text-[#374151] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            {t("gmHome.todayBtn", lang)}
          </button>
          <button
            onClick={() => setViewDate(new Date(year, month + 1))}
            className="p-1.5 rounded-lg text-[#9ca3af] dark:text-slate-400 hover:text-[#374151] dark:hover:text-slate-200 hover:bg-[#f3f4f6] dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS_SHORT.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-[#9ca3af] py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;
          const iso = fmtISO(day);
          const count = dayMap[iso] ?? 0;
          const intensity = count > 0 ? Math.min(1, count / maxCount) : 0;

          return (
            <a
              key={iso}
              href={`/appointments?date=${iso}`}
              className={`relative flex flex-col items-center justify-center rounded-lg h-9 text-xs transition-all group ${
                isToday(day)
                  ? "bg-accent-500 text-white font-bold shadow-sm"
                  : count > 0
                  ? "hover:bg-accent-500/20 text-[#374151] dark:text-slate-200"
                  : "hover:bg-[#f3f4f6] dark:hover:bg-white/[0.05] text-[#6b7280] dark:text-slate-500"
              }`}
              style={
                !isToday(day) && count > 0
                  ? { backgroundColor: `rgba(11,155,107,${0.07 + intensity * 0.18})` }
                  : undefined
              }
              title={count > 0 ? `${count} bookings` : undefined}
            >
              <span>{day}</span>
              {count > 0 && (
                <span className={`text-[8px] font-medium leading-none mt-0.5 ${isToday(day) ? "text-white/70" : "text-accent-600 dark:text-accent-400"}`}>
                  {count}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10px] text-[#9ca3af]">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-accent-500" />
          <span>{t("gmHome.todayLegend", lang)}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-accent-500/25" />
          <span>{t("gmHome.bookingsLegend", lang)}</span>
        </div>
      </div>
    </Card>
  );
}
