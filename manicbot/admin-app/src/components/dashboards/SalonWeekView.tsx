"use client";

/**
 * SalonWeekView — 7-day hour grid (Mon–Sun) with appointments laid out as
 * positioned blocks colored by master.
 *
 * Built on the same primitives as SalonDayView (HOUR_HEIGHT, master palette,
 * timeToTop / durationToHeight) but with 7 columns instead of N master
 * columns. Each appointment block shows time + client + service + the
 * master's color stripe; clicking opens the AptCard drawer below.
 *
 * Mobile (<640px): shows a 3-day sliding window instead of all 7 days at
 * once. The week-level prev/next navigation in the header still moves full
 * weeks; the dot-indicator row below the header shifts the 3-day window
 * within the current week. Today is auto-centered on week navigation.
 *
 * Per §12.1 of the Booksy comparison plan — Week view item.
 */

import { useMemo, useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { AptCard } from "~/components/dashboard-ui/AptCard";

const HOUR_HEIGHT = 48; // slightly tighter than Day view (more density per row in Week)
const HOUR_START = 8;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const MOBILE_COLS = 3; // days visible at once on narrow screens

const MASTER_PALETTE = [
  { bg: "rgba(124,58,237,0.18)", border: "rgba(124,58,237,0.55)", text: "#7c3aed" },
  { bg: "rgba(11,155,107,0.18)", border: "rgba(11,155,107,0.55)", text: "#0b9b6b" },
  { bg: "rgba(6,182,212,0.18)",  border: "rgba(6,182,212,0.55)",  text: "#0891b2" },
  { bg: "rgba(244,114,182,0.18)", border: "rgba(244,114,182,0.55)", text: "#ec4899" },
  { bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.55)", text: "#d97706" },
  { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.55)", text: "#2563eb" },
  { bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.55)", text: "#9333ea" },
  { bg: "rgba(20,184,166,0.18)", border: "rgba(20,184,166,0.55)", text: "#0d9488" },
] as const;

interface MasterRow {
  chatId: number;
  name: string | null;
}

type AptRow = Record<string, any> & {
  id: number | string;
  date: string;
  time: string;
  status: string;
};

interface Props {
  /** Anchor date — the week shown is the Mon–Sun containing this date. */
  date: Date;
  setDate: (d: Date) => void;
  apts: AptRow[];
  masters: MasterRow[];
  isLoading: boolean;
  lang: Lang;
  onAction?: (id: number | string, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow?: (id: number | string, noShowBy: "client" | "master") => void;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseHHMMToMinutes(hhmm: string | undefined): number {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(":");
  return Number(h ?? 0) * 60 + Number(m ?? 0);
}

function timeToTop(hhmm: string): number {
  const minutes = parseHHMMToMinutes(hhmm);
  const start = HOUR_START * 60;
  return ((minutes - start) / 60) * HOUR_HEIGHT;
}

function durationToHeight(durationMin: number | null | undefined): number {
  const d = Math.max(15, durationMin ?? 60);
  return (d / 60) * HOUR_HEIGHT;
}

/** Return Mon-anchored ISO dates for the week containing `d`. */
function weekDays(d: Date): Date[] {
  const monday = new Date(d);
  // JS getDay: 0=Sun … 6=Sat; we want Mon=0 … Sun=6.
  const dayIdx = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayIdx);
  monday.setHours(0, 0, 0, 0);
  const out: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    out.push(day);
  }
  return out;
}

export function SalonWeekView({
  date,
  setDate,
  apts,
  masters,
  isLoading,
  lang,
  onAction,
  onNoShow,
}: Props) {
  const days = useMemo(() => weekDays(date), [date]);
  const todayIso = fmtIsoDate(new Date());
  const weekHasToday = days.some((d) => fmtIsoDate(d) === todayIso);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // ── Mobile 3-day sliding window ──────────────────────────────────────────
  // isMobile is false during SSR; set to true by the matchMedia effect so
  // the initial paint is always full-week (avoids hydration mismatch).
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOffset, setMobileOffset] = useState(0); // 0–4 (days[offset..offset+3])

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Auto-center today when the user navigates to a different week.
  // On weeks that don't contain today, start from Monday (offset=0).
  useEffect(() => {
    const todayIdx = days.findIndex((d) => fmtIsoDate(d) === todayIso);
    if (todayIdx >= 0) {
      // Center today: offset = todayIdx - 1, clamped to valid range [0, 4].
      setMobileOffset(Math.max(0, Math.min(7 - MOBILE_COLS, todayIdx - 1)));
    } else {
      setMobileOffset(0);
    }
  }, [days]); // intentionally omit todayIso — changes only at midnight, not worth the complexity

  // Visible days: 3 on mobile, all 7 on desktop.
  const visibleDays = isMobile ? days.slice(mobileOffset, mobileOffset + MOBILE_COLS) : days;

  // Today's column index within the *visible* slice — needed for now-line position.
  const visibleTodayColumnIndex = visibleDays.findIndex((d) => fmtIsoDate(d) === todayIso);

  // Master color lookup — same palette mapping as Day view, by master index.
  const masterColor = useMemo(() => {
    const map = new Map<number, (typeof MASTER_PALETTE)[number]>();
    masters.forEach((m, idx) => {
      map.set(m.chatId, MASTER_PALETTE[idx % MASTER_PALETTE.length]!);
    });
    return map;
  }, [masters]);
  const fallbackTone = MASTER_PALETTE[0]!;

  // Apts grouped by date.
  const aptsByDate = useMemo(() => {
    const m = new Map<string, AptRow[]>();
    const dayIso = new Set(days.map(fmtIsoDate));
    for (const a of apts) {
      if (!dayIso.has(a.date)) continue;
      const list = m.get(a.date) ?? [];
      list.push(a);
      m.set(a.date, list);
    }
    return m;
  }, [apts, days]);

  // Auto-scroll to current time when this week contains today.
  useEffect(() => {
    if (!weekHasToday || !scrollerRef.current) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const offset = ((minutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
    if (offset < 0) return;
    const tid = window.setTimeout(() => {
      scrollerRef.current?.scrollTo({ top: Math.max(0, offset - HOUR_HEIGHT * 1.5), behavior: "smooth" });
    }, 100);
    return () => window.clearTimeout(tid);
  }, [weekHasToday]);

  // Current-time line.
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    if (!weekHasToday) return;
    const interval = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [weekHasToday]);
  const currentTimeTop = ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  // Show the now-line only when today is within the visible window.
  const currentTimeVisible =
    weekHasToday &&
    nowMinutes >= HOUR_START * 60 &&
    nowMinutes < HOUR_END * 60 &&
    visibleTodayColumnIndex >= 0;

  const locale =
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU";

  const goPrev = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 7);
    setDate(d);
  };
  const goNext = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 7);
    setDate(d);
  };
  const goToday = () => setDate(new Date());

  const [selectedApt, setSelectedApt] = useState<AptRow | null>(null);

  const weekLabel = (() => {
    const first = days[0]!;
    const last = days[6]!;
    const sameMonth = first.getMonth() === last.getMonth();
    if (sameMonth) {
      return `${first.getDate()}–${last.getDate()} ${first.toLocaleDateString(locale, { month: "long", year: "numeric" })}`;
    }
    return `${first.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${last.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
  })();

  // Column pixel width: narrower on mobile so 3 columns fit comfortably.
  const colWidth = isMobile ? 100 : 140;

  return (
    <div className="space-y-3" data-testid="salon-week-view">
      {/* Header */}
      <div className="glass-card rounded-2xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white capitalize truncate">{weekLabel}</h2>
          {isLoading && (
            <div className="w-3 h-3 rounded-full border-2 border-brand-500/40 border-t-brand-400 animate-spin shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goPrev}
            data-testid="week-view-prev"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            aria-label={t("salon.week.prev", lang)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            data-testid="week-view-today"
            className="px-2 py-1 rounded-lg text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {t("salon.week.thisWeek", lang)}
          </button>
          <button
            onClick={goNext}
            data-testid="week-view-next"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            aria-label={t("salon.week.next", lang)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile 3-day window navigator — dots + left/right arrows.
          Hidden on sm+ screens where the full 7-day grid is shown. */}
      {isMobile && (
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setMobileOffset((o) => Math.max(0, o - 1))}
            disabled={mobileOffset === 0}
            data-testid="week-view-mobile-prev"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-30"
            aria-label={t("salon.week.prev", lang)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {/* 7 dots — pill shape for the 3 visible, small circle for the rest.
              Tapping a dot jumps to a window starting at that day. */}
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Day selector">
            {days.map((day, i) => {
              const isVisible = i >= mobileOffset && i < mobileOffset + MOBILE_COLS;
              const isToday = fmtIsoDate(day) === todayIso;
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={isVisible}
                  onClick={() => setMobileOffset(Math.max(0, Math.min(7 - MOBILE_COLS, i)))}
                  className={`rounded-full transition-all ${
                    isVisible
                      ? "h-1.5 w-4"
                      : "h-1.5 w-1.5"
                  } ${
                    isToday
                      ? "bg-brand-500"
                      : isVisible
                      ? "bg-slate-500 dark:bg-slate-400"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                  title={day.toLocaleDateString(locale, { weekday: "short", day: "numeric" })}
                />
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setMobileOffset((o) => Math.min(7 - MOBILE_COLS, o + 1))}
            disabled={mobileOffset >= 7 - MOBILE_COLS}
            data-testid="week-view-mobile-next"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-30"
            aria-label={t("salon.week.next", lang)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Empty state when no apts in the entire week */}
      {aptsByDate.size === 0 && !isLoading && (
        <div className="glass-card rounded-2xl py-12 px-4 text-center" data-testid="week-view-empty">
          <CalendarDays className="h-8 w-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("salon.cal.noUpcoming", lang)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("salon.empty.apts", lang)}</p>
        </div>
      )}

      {/* Hour grid + visible day columns (3 on mobile, 7 on desktop) */}
      <div
        ref={scrollerRef}
        className="glass-card rounded-2xl overflow-auto"
        style={{ maxHeight: "calc(100vh - 280px)" }}
      >
        <div
          className="flex"
          style={{ minWidth: 80 + visibleDays.length * colWidth }}
        >
          {/* Hour scale */}
          <div className="shrink-0 w-20 sticky left-0 z-10 bg-white/95 dark:bg-slate-900/80 backdrop-blur-sm border-r border-slate-200 dark:border-white/10">
            <div className="h-12 border-b border-slate-200 dark:border-white/10" />
            {Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i).map((h) => (
              <div
                key={h}
                className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 text-right pr-1 sm:pr-2 border-b border-slate-200 dark:border-white/10"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="relative -top-1.5 tabular-nums">{pad(h)}:00</span>
              </div>
            ))}
          </div>

          {/* Visible day columns */}
          <div className="flex-1 flex relative">
            {visibleDays.map((day, visIdx) => {
              const iso = fmtIsoDate(day);
              const isTodayCol = iso === todayIso;
              const list = aptsByDate.get(iso) ?? [];
              return (
                <div
                  key={iso}
                  className={`flex-1 border-r border-slate-200 dark:border-white/10 last:border-r-0 relative ${
                    isTodayCol ? "bg-brand-500/[0.025] dark:bg-brand-500/[0.04]" : ""
                  }`}
                  style={{ minWidth: colWidth }}
                  data-testid="week-view-day-column"
                  data-day={iso}
                >
                  {/* Day header */}
                  <div
                    className={`h-12 flex flex-col items-center justify-center border-b border-slate-200 dark:border-white/10 sticky top-0 z-10 backdrop-blur-sm ${
                      isTodayCol
                        ? "bg-brand-500/10 dark:bg-brand-500/15"
                        : "bg-white/70 dark:bg-slate-900/40"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      {day.toLocaleDateString(locale, { weekday: "short" })}
                    </span>
                    <span
                      className={`text-sm font-bold tabular-nums ${
                        isTodayCol
                          ? "text-brand-600 dark:text-brand-300"
                          : "text-slate-700 dark:text-slate-200"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {/* Google-Calendar-style ruled grid: solid hour lines +
                      dashed half-hour lines + appointment blocks */}
                  <div
                    className="relative"
                    style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
                    data-testid="week-view-column-body"
                  >
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => i).map((i) => (
                      <div key={`h-${i}`}>
                        {i > 0 && (
                          <div
                            className="absolute left-0 right-0 border-t border-slate-200 dark:border-white/[0.08] pointer-events-none"
                            style={{ top: i * HOUR_HEIGHT }}
                          />
                        )}
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-slate-100 dark:border-white/[0.04] pointer-events-none"
                          style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                        />
                      </div>
                    ))}
                    {list.map((a) => {
                      const top = timeToTop(a.time);
                      const height = durationToHeight(a.duration);
                      const tone =
                        (typeof a.masterId === "number" && masterColor.get(a.masterId)) || fallbackTone;
                      const isCancelled = !!a.cancelled || a.status === "cancelled" || a.status === "rejected";
                      const isNoShow = !!a.noShow;
                      const opacity = isCancelled || isNoShow ? 0.45 : 1;
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => setSelectedApt(a)}
                          data-testid="week-view-event"
                          data-apt-id={a.id}
                          className="absolute left-1 right-1 rounded-lg px-1.5 py-1 text-left transition-shadow hover:shadow-lg overflow-hidden"
                          style={{
                            top,
                            height,
                            background: tone.bg,
                            borderLeft: `3px solid ${tone.border}`,
                            opacity,
                          }}
                          title={`${a.time} ${a.userName ?? ""}`.trim()}
                        >
                          <div className="text-[9px] font-bold tabular-nums" style={{ color: tone.text }}>
                            {a.time}
                          </div>
                          <div className="text-[10px] font-medium text-slate-800 dark:text-white truncate leading-tight">
                            {a.userName ?? a.userTg ?? `#${a.chatId ?? ""}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Current-time red line — drawn over today's visible column only */}
            {currentTimeVisible && visibleTodayColumnIndex >= 0 && (
              <div
                data-testid="week-view-now-line"
                className="absolute pointer-events-none z-20"
                style={{
                  top: 48 + currentTimeTop,
                  left: `${(visibleTodayColumnIndex / visibleDays.length) * 100}%`,
                  width: `${100 / visibleDays.length}%`,
                }}
              >
                <div className="h-px bg-red-500/80" />
                <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected apt drawer */}
      {selectedApt && (
        <div className="glass-card rounded-2xl p-4 space-y-3" data-testid="week-view-selected">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {selectedApt.date} {selectedApt.time}
              {selectedApt.userName ? ` · ${selectedApt.userName}` : ""}
            </h3>
            <button
              onClick={() => setSelectedApt(null)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ×
            </button>
          </div>
          <AptCard a={selectedApt} lang={lang} onAction={onAction} onNoShow={onNoShow} />
        </div>
      )}
    </div>
  );
}
