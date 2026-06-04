"use client";

/**
 * DatePicker — brand-styled replacement for `<input type="date">`.
 *
 * Native date inputs invoke an OS-level calendar popover that ignores
 * page theming and looks out of place inside our dark dashboard modals
 * (see MasterDetailModal Urlop section). This component renders a
 * controlled popover inside the React tree with the same colors,
 * radii, and motion language as Select.tsx, so date pickers visually
 * match our dropdowns and never escape the z-index of the modal that
 * contains them.
 *
 * API mirrors a controlled `<input type="date">` for one-line swaps:
 *   <DatePicker value="2026-05-24" onChange={setV} lang={lang} />
 *
 * - Click trigger to toggle the calendar popover.
 * - Month grid is Mon-first (matches existing iOS screenshot + CLDR ru/ua/pl).
 * - Prev/next month arrows; click the month/year label to step the year.
 * - Selected day highlighted in brand purple; today gets a subtle ring.
 * - `min` / `max` (YYYY-MM-DD) grey out out-of-range days.
 * - Escape / outside click closes.
 * - `placeholder` shows when value is empty.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { type Lang, localeFor, t } from "~/lib/i18n";

interface Props {
  /** ISO date string `YYYY-MM-DD` or empty when no date is selected. */
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
  /** Inclusive lower bound, `YYYY-MM-DD`. */
  min?: string;
  /** Inclusive upper bound, `YYYY-MM-DD`. */
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Keeps multiple pickers on one page distinguishable in tests. */
  testIdPrefix?: string;
  className?: string;
}

const TRIGGER_BASE =
  "w-full flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-900 outline-none transition focus:border-brand-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:focus:border-violet-400";

const TRIGGER_DISABLED = "opacity-60 cursor-not-allowed";
const TRIGGER_ENABLED = "hover:border-slate-300 dark:hover:border-white/20 cursor-pointer";

/** Parses `YYYY-MM-DD` into a UTC Date (avoids TZ drift). Returns null on bad input. */
function parseIso(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Today as a `YYYY-MM-DD` string in the user's local timezone, then re-anchored to UTC. */
function todayIso(): string {
  const now = new Date();
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
  disabled: boolean;
  isToday: boolean;
  isSelected: boolean;
}

function buildMonthCells(
  visible: Date,
  selectedIso: string,
  todayIsoStr: string,
  min: string | undefined,
  max: string | undefined,
): DayCell[] {
  const year = visible.getUTCFullYear();
  const month = visible.getUTCMonth();

  // First day of the visible month
  const first = new Date(Date.UTC(year, month, 1));
  // Mon-first: getUTCDay returns 0 (Sun)..6 (Sat). Shift so Mon=0.
  const dow = (first.getUTCDay() + 6) % 7;

  // Start cell is the Monday on or before the 1st.
  const start = new Date(Date.UTC(year, month, 1 - dow));

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = toIso(d);
    const disabled = (min ? iso < min : false) || (max ? iso > max : false);
    cells.push({
      iso,
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month,
      disabled,
      isToday: iso === todayIsoStr,
      isSelected: iso === selectedIso,
    });
  }
  return cells;
}

export function DatePicker({
  value,
  onChange,
  lang,
  min,
  max,
  placeholder,
  disabled,
  testIdPrefix = "datepicker",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // On phones the left-anchored popover overflows the right viewport edge when
  // the trigger sits in a right-hand column (the Отпуск "По" field). Below the
  // sm breakpoint we portal the calendar into a centered overlay instead.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const todayIsoStr = useMemo(() => todayIso(), []);
  const selectedDate = useMemo(() => parseIso(value), [value]);

  // The month currently shown in the grid. Initialized from `value` or today.
  const [visible, setVisible] = useState<Date>(() => {
    const init = parseIso(value) ?? parseIso(todayIsoStr) ?? new Date();
    return new Date(Date.UTC(init.getUTCFullYear(), init.getUTCMonth(), 1));
  });

  // When `value` changes externally, re-anchor the visible month.
  useEffect(() => {
    const parsed = parseIso(value);
    if (parsed) {
      setVisible((prev) => {
        if (
          prev.getUTCFullYear() === parsed.getUTCFullYear() &&
          prev.getUTCMonth() === parsed.getUTCMonth()
        ) return prev;
        return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
      });
    }
  }, [value]);

  // Outside-click + Escape close (mirrors Select.tsx).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      // The mobile popover portals out of wrapRef, so also treat clicks inside
      // the popover itself as "inside" (the scrim is the only outside surface).
      if (wrapRef.current?.contains(target)) return;
      if (popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const locale = localeFor(lang);

  // Mon-first weekday short labels via Intl. We pick a known Monday and step 7 times.
  const weekdayLabels = useMemo(() => {
    const out: string[] = [];
    // 2024-01-01 was a Monday (UTC).
    const base = new Date(Date.UTC(2024, 0, 1));
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setUTCDate(base.getUTCDate() + i);
      out.push(fmt.format(d).toUpperCase().replace(/\.$/, ""));
    }
    return out;
  }, [locale]);

  const monthYearLabel = useMemo(() => {
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(visible);
  }, [locale, visible]);

  const triggerLabel = useMemo(() => {
    if (!selectedDate) return placeholder ?? "";
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(selectedDate);
  }, [locale, selectedDate, placeholder]);

  const cells = useMemo(
    () => buildMonthCells(visible, value, todayIsoStr, min, max),
    [visible, value, todayIsoStr, min, max],
  );

  const stepMonth = (delta: number) => {
    setVisible((prev) => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + delta, 1)));
  };

  const stepYear = (delta: number) => {
    setVisible((prev) => new Date(Date.UTC(prev.getUTCFullYear() + delta, prev.getUTCMonth(), 1)));
  };

  const goToday = () => {
    const td = parseIso(todayIsoStr);
    if (!td) return;
    setVisible(new Date(Date.UTC(td.getUTCFullYear(), td.getUTCMonth(), 1)));
    // Only auto-select today if it falls within min/max
    if ((!min || todayIsoStr >= min) && (!max || todayIsoStr <= max)) {
      onChange(todayIsoStr);
      setOpen(false);
    }
  };

  const clear = () => {
    onChange("");
    setOpen(false);
  };

  const hasValue = !!selectedDate;

  return (
    <div
      ref={wrapRef}
      className={`relative ${className ?? ""}`}
      data-testid={testIdPrefix}
    >
      <button
        type="button"
        disabled={!!disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        data-testid={`${testIdPrefix}-trigger`}
        data-open={open ? "1" : "0"}
        data-value={value || ""}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${TRIGGER_BASE} ${disabled ? TRIGGER_DISABLED : TRIGGER_ENABLED}`}
      >
        <Calendar className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className={`flex-1 truncate ${hasValue ? "" : "text-slate-400 dark:text-white/30"}`}>
          {triggerLabel || placeholder || ""}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-500 dark:text-slate-400 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (() => {
        const popover = (
        <div
          role="dialog"
          aria-label={triggerLabel || placeholder || "calendar"}
          data-testid={`${testIdPrefix}-popover`}
          ref={popRef}
          className={
            isMobile
              ? "relative z-[1] w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-3 shadow-2xl shadow-black/20 dark:shadow-black/60"
              : "absolute left-0 top-full mt-1.5 z-50 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 p-3 shadow-2xl shadow-black/20 dark:shadow-black/60 animate-[datepicker-fade-in_120ms_ease-out]"
          }
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <button
              type="button"
              onClick={() => stepYear(-1)}
              data-testid={`${testIdPrefix}-prev-year`}
              aria-label="prev year"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
            >
              <ChevronLeft className="h-4 w-4 -mr-2" />
              <ChevronLeft className="h-4 w-4 -ml-2" />
            </button>
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              data-testid={`${testIdPrefix}-prev-month`}
              aria-label="prev month"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div
              className="flex-1 text-center text-sm font-semibold text-slate-900 dark:text-slate-100 capitalize"
              data-testid={`${testIdPrefix}-month-label`}
            >
              {monthYearLabel}
            </div>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              data-testid={`${testIdPrefix}-next-month`}
              aria-label="next month"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => stepYear(1)}
              data-testid={`${testIdPrefix}-next-year`}
              aria-label="next year"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
            >
              <ChevronRight className="h-4 w-4 -mr-2" />
              <ChevronRight className="h-4 w-4 -ml-2" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 px-1 pb-1">
            {weekdayLabels.map((wd, i) => (
              <div
                key={i}
                className="text-center text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 py-1"
              >
                {wd}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 px-1">
            {cells.map((c) => {
              const base = "h-9 rounded-md text-sm tabular-nums flex items-center justify-center transition-colors";
              let cls = "";
              if (c.disabled) {
                cls = "text-slate-300 dark:text-slate-600 cursor-not-allowed";
              } else if (c.isSelected) {
                cls =
                  "bg-brand-500 text-white font-semibold shadow-sm shadow-brand-500/30 hover:bg-brand-600";
              } else if (!c.inMonth) {
                cls = "text-slate-400 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-white/[0.03]";
              } else if (c.isToday) {
                cls =
                  "text-brand-700 dark:text-brand-300 ring-1 ring-brand-400/60 dark:ring-brand-400/40 hover:bg-brand-500/10";
              } else {
                cls = "text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.04]";
              }
              return (
                <button
                  key={c.iso}
                  type="button"
                  disabled={c.disabled}
                  onClick={() => {
                    if (c.disabled) return;
                    onChange(c.iso);
                    setOpen(false);
                  }}
                  data-testid={`${testIdPrefix}-day`}
                  data-iso={c.iso}
                  data-selected={c.isSelected ? "1" : "0"}
                  data-today={c.isToday ? "1" : "0"}
                  data-in-month={c.inMonth ? "1" : "0"}
                  aria-pressed={c.isSelected}
                  aria-label={c.iso}
                  className={`${base} ${cls}`}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/5">
            <button
              type="button"
              onClick={goToday}
              data-testid={`${testIdPrefix}-today`}
              className="rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-500/10 dark:text-brand-300"
            >
              {t("common.today", lang)}
            </button>
            {hasValue && (
              <button
                type="button"
                onClick={clear}
                data-testid={`${testIdPrefix}-clear`}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.04]"
              >
                {t("masterDetail.settings.vacation.clearCta", lang)}
              </button>
            )}
          </div>
        </div>
        );
        if (isMobile && typeof document !== "undefined") {
          return createPortal(
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-slate-900/40"
                aria-hidden
                onClick={() => setOpen(false)}
              />
              {popover}
            </div>,
            document.body,
          );
        }
        return popover;
      })()}

      <style jsx>{`
        @keyframes datepicker-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
