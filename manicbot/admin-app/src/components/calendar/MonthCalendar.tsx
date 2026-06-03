"use client";

/**
 * MonthCalendar — shared Google Calendar-style month grid used by every
 * appointments view in the app:
 *
 *   - system_admin → /appointments (cross-tenant view)
 *   - tenant_owner → /dashboard?tab=appointments (single-tenant)
 *   - master       → /dashboard?tab=schedule  (own bookings only)
 *
 * The component is data-shape-agnostic (it accepts a loose `Apt` row type
 * with `.id / .date / .time / .status / .userName / .masterId / …`) so
 * each role can pass whatever its tRPC router returns. The container is
 * responsible for filtering / scoping the appointments before passing
 * them in — MonthCalendar only renders.
 *
 * Visual contract:
 *   - Mon-anchored grid, prev/next month days padded so every cell is a
 *     real date (out-of-month days subtly muted).
 *   - Today's number gets a filled brand circle (GCal parity).
 *   - Each event chip gets a master-colored stripe on the left, status-
 *     toned bg, bold time + truncated client name.
 *   - Cancelled / no-show events render line-through @ 55% opacity.
 *   - 3 events per cell + "+N more" overflow.
 *   - Light + dark contrast tuned (white surfaces vs slate-900/40).
 *   - Selected day highlighted with a left accent bar.
 */

import { useMemo, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import type { AnchorRect } from "~/lib/calendar/useAnchoredPosition";
import { MASTER_EVENT_HUES } from "~/lib/theme/palette";

/** Brand-derived hue order — must match SalonDayView/Week so the same
 *  master always renders in the same color across every view. Sourced from
 *  the shared theme palette (red/turquoise first) so all calendar surfaces
 *  agree per master. */
export const MONTH_CAL_MASTER_PALETTE = [...MASTER_EVENT_HUES];

const WEEKDAYS_BY_LANG: Record<string, string[]> = {
  ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  ua: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  pl: ["Pn", "Wt", "Śr", "Cz", "Pt", "Sb", "Nd"],
};

export interface MonthCalApt {
  id: number | string;
  date: string;
  time: string;
  status: string;
  cancelled?: number | boolean | null;
  noShow?: number | boolean | null;
  masterId?: number | null;
  userName?: string | null;
  userTg?: string | null;
  chatId?: number | null;
  svcId?: string | null;
  // Allow extra fields — consumers may pass richer rows.
  [key: string]: any;
}

export interface MonthCalMaster {
  chatId: number;
  name: string | null;
}

interface Props {
  apts: MonthCalApt[];
  viewDate: Date;
  setViewDate: (d: Date) => void;
  selectedDay: string | null;
  setSelectedDay: (iso: string | null) => void;
  isLoading?: boolean;
  lang: Lang;
  /** Optional master list — when provided, events use the master's color. */
  masters?: MonthCalMaster[];
  /** Optional title shown in the header bar (defaults to localized month). */
  titleOverride?: string;
  /**
   * When provided, each event chip becomes individually clickable and opens
   * the caller's detail popover anchored to the chip (GCal parity). Omitted
   * by read-only callers (God-Mode page), where chips stay non-interactive
   * and a cell click just selects the day.
   */
  onEventClick?: (apt: MonthCalApt, rect: AnchorRect) => void;
  /** Rendered in the header, right of the prev/today/next nav — the calendar
   *  view switcher. */
  headerRight?: ReactNode;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtIso(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** Status → chip tint (bg + text). Cancelled / no_show fade through opacity. */
function statusTone(sk: string): { bg: string; text: string } {
  if (sk === "pending") return { bg: "var(--status-pending-bg)", text: "var(--status-pending-text)" };
  if (sk === "confirmed") return { bg: "var(--status-confirmed-bg)", text: "var(--status-confirmed-text)" };
  if (sk === "done") return { bg: "var(--status-done-bg)", text: "var(--status-done-text)" };
  if (sk === "no_show") return { bg: "var(--status-noshow-bg)", text: "var(--status-noshow-text)" };
  if (sk === "cancelled" || sk === "rejected")
    return { bg: "var(--status-cancelled-bg)", text: "var(--status-cancelled-text)" };
  return { bg: "var(--status-neutral-bg)", text: "var(--status-neutral-text)" };
}

function statusKeyOf(a: MonthCalApt): string {
  if (a.noShow) return "no_show";
  if (a.cancelled || a.status === "cancelled" || a.status === "rejected") return "cancelled";
  if (a.status === "done") return "done";
  if (a.status === "confirmed") return "confirmed";
  return "pending";
}

export function MonthCalendar({
  apts,
  viewDate,
  setViewDate,
  selectedDay,
  setSelectedDay,
  isLoading,
  lang,
  masters,
  titleOverride,
  onEventClick,
  headerRight,
}: Props) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const todayIso = fmtIso(today.getFullYear(), today.getMonth(), today.getDate());

  // ── Cells: pad with prev/next month days so every cell is a real date. ──
  const cells = useMemo(() => {
    const firstDowSun = new Date(year, month, 1).getDay();
    // Mon-anchored — JS getDay returns 0=Sun, we want Mon=0.
    const firstDow = (firstDowSun + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    const out: { day: number; month: number; year: number; inMonth: boolean }[] = [];
    if (firstDow > 0) {
      const prev = new Date(year, month, 0);
      const prevYear = prev.getFullYear();
      const prevMonth = prev.getMonth();
      const prevDays = prev.getDate();
      for (let i = firstDow - 1; i >= 0; i -= 1) {
        out.push({ day: prevDays - i, month: prevMonth, year: prevYear, inMonth: false });
      }
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      out.push({ day: d, month, year, inMonth: true });
    }
    let nextDay = 1;
    const next = new Date(year, month + 1, 1);
    while (out.length < totalCells) {
      out.push({
        day: nextDay,
        month: next.getMonth(),
        year: next.getFullYear(),
        inMonth: false,
      });
      nextDay += 1;
    }
    return out;
  }, [year, month]);

  // master id → color
  const masterColorById = useMemo(() => {
    const m = new Map<number, string>();
    (masters ?? []).forEach((master, idx) => {
      m.set(master.chatId, MONTH_CAL_MASTER_PALETTE[idx % MONTH_CAL_MASTER_PALETTE.length]!);
    });
    return m;
  }, [masters]);

  // iso → sorted appointments
  const dayMap = useMemo(() => {
    const m: Record<string, MonthCalApt[]> = {};
    apts.forEach((a) => {
      if (!m[a.date]) m[a.date] = [];
      m[a.date]!.push(a);
    });
    Object.values(m).forEach((arr) =>
      arr.sort((x, y) => (x.time ?? "").localeCompare(y.time ?? "")),
    );
    return m;
  }, [apts]);

  const monthLabel = viewDate.toLocaleString(
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU",
    { month: "long", year: "numeric" },
  );
  const weekdays = WEEKDAYS_BY_LANG[lang] ?? WEEKDAYS_BY_LANG.ru!;

  return (
    <div className="glass-card rounded-2xl overflow-hidden" data-testid="month-calendar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/70 dark:border-white/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarDays className="w-4 h-4 text-brand-500 dark:text-brand-400 shrink-0" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white capitalize truncate">
            {titleOverride ?? monthLabel}
          </h2>
          {isLoading && (
            <div className="w-3 h-3 rounded-full border-2 border-brand-500/40 border-t-brand-500 dark:border-t-brand-400 animate-spin shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => setViewDate(new Date(year, month - 1, 1))}
            data-testid="month-cal-prev"
            aria-label={t("salon.day.prev", lang)}
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setViewDate(new Date());
              setSelectedDay(null);
            }}
            data-testid="month-cal-today"
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {t("salon.cal.todaySmall", lang)}
          </button>
          <button
            type="button"
            onClick={() => setViewDate(new Date(year, month + 1, 1))}
            data-testid="month-cal-next"
            aria-label={t("salon.day.next", lang)}
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {headerRight}
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-slate-200/70 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
        {weekdays.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[10px] font-semibold uppercase tracking-wider py-2 ${
              i >= 5
                ? "text-slate-400 dark:text-slate-500"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 bg-slate-200/60 dark:bg-white/[0.04] gap-px">
        {cells.map((c, i) => {
          const iso = fmtIso(c.year, c.month, c.day);
          const dayApts = dayMap[iso] ?? [];
          const count = dayApts.length;
          const isSelected = selectedDay === iso;
          const isTodayCell = iso === todayIso;
          const visible = dayApts.slice(0, 3);
          const overflow = count - visible.length;

          return (
            <button
              type="button"
              key={`${iso}-${i}`}
              onClick={() => setSelectedDay(isSelected ? null : iso)}
              data-testid="month-cal-day"
              data-day={iso}
              data-in-month={c.inMonth ? "1" : "0"}
              data-today={isTodayCell ? "1" : "0"}
              data-selected={isSelected ? "1" : "0"}
              className={`group relative flex flex-col text-left transition-colors min-h-[112px] p-1.5 sm:p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60 ${
                isSelected
                  ? "bg-brand-500/[0.08] dark:bg-brand-500/[0.12]"
                  : c.inMonth
                    ? "bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                    : "bg-slate-50/70 dark:bg-slate-900/20 hover:bg-slate-100 dark:hover:bg-white/[0.03]"
              }`}
            >
              {/* Day number — circle for today */}
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`inline-flex items-center justify-center text-[11px] font-bold leading-none tabular-nums transition-all h-6 w-6 ${
                    isTodayCell
                      ? "rounded-full bg-brand-500 text-white shadow-sm"
                      : c.inMonth
                        ? "text-slate-700 dark:text-slate-200"
                        : "text-slate-400 dark:text-slate-600"
                  }`}
                >
                  {c.day}
                </span>
                {count > 0 && c.inMonth && (
                  <span
                    className={`text-[9px] font-semibold tabular-nums ${
                      isTodayCell
                        ? "text-brand-500 dark:text-brand-400"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </div>

              {/* Event chips */}
              <div className="flex flex-col gap-0.5 w-full">
                {visible.map((a) => {
                  const sk = statusKeyOf(a);
                  const tone = statusTone(sk);
                  const masterColor =
                    a.masterId != null ? masterColorById.get(Number(a.masterId)) : undefined;
                  const accent = masterColor ?? tone.text;
                  const isMuted = sk === "cancelled" || sk === "rejected" || sk === "no_show";
                  return (
                    <div
                      key={a.id}
                      data-testid="month-cal-event"
                      data-status={sk}
                      data-apt-id={a.id}
                      // Kept a <div> (not a <button>) because the day cell is
                      // already a <button> — nesting buttons is invalid DOM.
                      // role/tabIndex make the chip keyboard-accessible only
                      // when the caller wired onEventClick.
                      role={onEventClick ? "button" : undefined}
                      tabIndex={onEventClick ? 0 : undefined}
                      onClick={
                        onEventClick
                          ? (e) => {
                              e.stopPropagation();
                              const r = e.currentTarget.getBoundingClientRect();
                              onEventClick(a, { left: r.left, top: r.top, width: r.width, height: r.height });
                            }
                          : undefined
                      }
                      onKeyDown={
                        onEventClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                const r = e.currentTarget.getBoundingClientRect();
                                onEventClick(a, { left: r.left, top: r.top, width: r.width, height: r.height });
                              }
                            }
                          : undefined
                      }
                      className={`relative flex items-center gap-1 rounded text-[10px] leading-tight pl-1.5 pr-1 py-[2px] truncate font-medium overflow-hidden ${
                        isMuted ? "opacity-55" : ""
                      } ${onEventClick ? "cursor-pointer hover:brightness-95 dark:hover:brightness-110" : ""}`}
                      style={{ background: tone.bg, color: tone.text }}
                    >
                      <span
                        className="absolute left-0 top-0 bottom-0 w-1 rounded-l"
                        style={{ background: accent }}
                        aria-hidden
                      />
                      <span
                        className="font-bold tabular-nums shrink-0 ml-0.5"
                        style={{ color: accent }}
                      >
                        {a.time}
                      </span>
                      <span className={`truncate ${isMuted ? "line-through" : ""}`}>
                        {a.userName ?? a.userTg ?? `#${a.chatId ?? ""}`}
                      </span>
                    </div>
                  );
                })}
                {overflow > 0 && (
                  <span
                    className="text-[10px] font-semibold pl-1 text-slate-500 dark:text-slate-400"
                    data-testid="month-cal-overflow"
                  >
                    +{overflow} {t("salon.cal.more", lang)}
                  </span>
                )}
              </div>

              {isSelected && (
                <span
                  className="absolute left-0 top-0 bottom-0 w-0.5 bg-brand-500"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 px-4 py-2.5 border-t border-slate-200/70 dark:border-white/[0.06] text-[10px] text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-brand-500" />
          <span>{t("salon.cal.today", lang)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded" style={{ background: "var(--status-pending-dot)" }} />
          <span>{t("salon.cal.pending", lang)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded" style={{ background: "var(--status-confirmed-dot)" }} />
          <span>{t("salon.cal.confirmed", lang)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded" style={{ background: "var(--status-noshow-dot)" }} />
          <span>{t("status.no_show", lang)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded opacity-50"
            style={{ background: "var(--status-neutral-dot)" }}
          />
          <span>{t("status.cancelled", lang)}</span>
        </div>
      </div>
    </div>
  );
}
