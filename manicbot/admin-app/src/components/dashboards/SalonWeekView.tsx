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
import { ChevronLeft, ChevronRight, CalendarDays, Lock } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { AptCard } from "~/components/dashboard-ui/AptCard";
import { AppointmentDetailPanel, type SelectedAppointment } from "~/components/dashboard-ui/AppointmentDetailPanel";
import type { AnchorRect } from "~/lib/calendar/useAnchoredPosition";
import { DragCreateLayer } from "~/components/calendar/DragCreateLayer";
import { CreateSlotPopover } from "~/components/calendar/CreateSlotPopover";
import type { DragGhost } from "~/lib/calendar/useDragToCreate";
import { useDragToMove, type MoveCommit } from "~/lib/calendar/useDragToMove";
import { computeLanes } from "~/lib/calendar/overlapLanes";
import type { DayViewBlock } from "~/components/dashboards/SalonDayView";
import { WEEKDAY_KEYS, type WorkHoursState, type DayHours } from "~/lib/workHours";

const HOUR_HEIGHT = 48; // slightly tighter than Day view (more density per row in Week)
const HOUR_START = 8;
const HOUR_END = 22;
const TOTAL_HOURS = HOUR_END - HOUR_START;

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
  /**
   * Salon-level working hours from «Godziny pracy». When provided, the week
   * grid shades non-working time (before open / after close / days off) with
   * the same gray gradient used for time-off blocks. Optional — God-Mode and
   * per-master callers omit it (no overlay rendered).
   */
  workHours?: WorkHoursState;
  isLoading: boolean;
  lang: Lang;
  onAction?: (id: number | string, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow?: (id: number | string, noShowBy: "client" | "master") => void;
  /** Calendar overhaul (2026-05-16) — block rendering + drag-to-create. */
  blocks?: DayViewBlock[];
  onCreateAt?: (info: { date: string; masterId: number | null; time: string; durationMin: number; modifier: DragGhost["modifier"] }) => void;
  onDeleteBlock?: (id: string) => void;
  /** Drag-to-reschedule: fires when the user drops a block on a new slot. */
  onMoveAppointment?: (move: MoveCommit) => void;
  /**
   * Rich detail panel — when `tenantId` + `services` are provided, clicking a
   * block opens `<AppointmentDetailPanel/>` (read/edit + status actions +
   * «Профиль клиента») instead of the legacy `AptCard` drawer. Mirrors the
   * SalonDayView contract; without them the view keeps the AptCard fallback
   * (God-Mode AppointmentsPageClient passes neither). `onUpdated` lets the
   * parent refetch after a save / status change / delete.
   */
  tenantId?: string;
  services?: Array<{ svcId: string; names?: string | null; duration: number; price: number }>;
  onUpdated?: () => void;
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

/**
 * Gray-band rects (top/height in px) for a weekday's salon working hours,
 * clamped to the visible [HOUR_START, HOUR_END] window. `null` (day off) →
 * one full-height band. Mirrors SalonDayView's per-master overlay geometry.
 */
function nonWorkingBands(dh: DayHours): Array<{ top: number; height: number }> {
  const totalH = TOTAL_HOURS * HOUR_HEIGHT;
  if (dh === null) return [{ top: 0, height: totalH }];
  const dayStart = HOUR_START * 60;
  const dayEnd = HOUR_END * 60;
  const openMin = parseHHMMToMinutes(dh.open);
  const closeMin = parseHHMMToMinutes(dh.close);
  // Invalid range, or hours entirely outside the visible window → whole day off.
  if (!(closeMin > openMin) || openMin >= dayEnd || closeMin <= dayStart) {
    return [{ top: 0, height: totalH }];
  }
  const startVis = Math.max(openMin, dayStart);
  const endVis = Math.min(closeMin, dayEnd);
  const bands: Array<{ top: number; height: number }> = [];
  const beforeH = ((startVis - dayStart) / 60) * HOUR_HEIGHT;
  if (beforeH > 0) bands.push({ top: 0, height: beforeH });
  const afterTop = ((endVis - dayStart) / 60) * HOUR_HEIGHT;
  if (totalH - afterTop > 0) bands.push({ top: afterTop, height: totalH - afterTop });
  return bands;
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
  workHours,
  isLoading,
  lang,
  onAction,
  onNoShow,
  blocks,
  onCreateAt,
  onDeleteBlock,
  onMoveAppointment,
  tenantId,
  services,
  onUpdated,
}: Props) {
  // Drag-to-reschedule — one hook instance owns the cross-column ghost
  // state. The Week view doesn't pin masters to columns, so commit will
  // always have `toMasterId === fromMasterId` here; the hook still resolves
  // it generically for Day-view parity.
  const { ghost: moveGhost, draggingId, bindBlock } = useDragToMove({
    hourHeight: HOUR_HEIGHT,
    hourStart: HOUR_START,
    hourEnd: HOUR_END,
    onCommit: (c) => onMoveAppointment?.(c),
  });
  const days = useMemo(() => weekDays(date), [date]);
  const todayIso = fmtIsoDate(new Date());
  const weekHasToday = days.some((d) => fmtIsoDate(d) === todayIso);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Mobile uses a narrower column width so 3-ish days fit at once; the user
  // scrolls horizontally to reach the rest of the week. Tracked via matchMedia
  // (false during SSR to avoid hydration mismatch).
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // All 7 days visible — the grid scrolls horizontally on mobile.
  // The dedicated mobile 3-day window navigator was removed because users read
  // it as a duplicate of the week-level prev/next chevrons above.
  const visibleDays = days;

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

  // Blocks grouped by date — same range-aware logic as Day view: a row is
  // "on" a given iso if its single-day date matches OR its multi-day
  // [date,endDate] window covers it.
  const blocksByDate = useMemo(() => {
    const m = new Map<string, DayViewBlock[]>();
    for (const b of blocks ?? []) {
      for (const d of days) {
        const iso = fmtIsoDate(d);
        const inRange = b.endDate
          ? b.date <= iso && b.endDate >= iso
          : b.date === iso;
        if (!inRange) continue;
        const list = m.get(iso) ?? [];
        list.push(b);
        m.set(iso, list);
      }
    }
    return m;
  }, [blocks, days]);

  // Auto-scroll to current time + today's column when this week contains today.
  // Horizontal scroll keeps today centred on mobile (where the 7 columns
  // overflow the viewport and the user otherwise lands on Monday).
  useEffect(() => {
    if (!weekHasToday || !scrollerRef.current) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const top = ((minutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
    const todayIdx = days.findIndex((d) => fmtIsoDate(d) === todayIso);
    const tid = window.setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      if (top >= 0) el.scrollTo({ top: Math.max(0, top - HOUR_HEIGHT * 1.5), behavior: "smooth" });
      if (todayIdx >= 0) {
        const colWidthNow = isMobile ? 100 : 140;
        const left = todayIdx * colWidthNow;
        el.scrollTo({ left: Math.max(0, left - colWidthNow * 0.5), behavior: "smooth" });
      }
    }, 100);
    return () => window.clearTimeout(tid);
  }, [weekHasToday, days, todayIso, isMobile]);

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
  // Viewport rect of the clicked block — anchors the detail popover (GCal style).
  const [selectedRect, setSelectedRect] = useState<AnchorRect | null>(null);
  // Pending empty-slot drag → quick-create popover (intercepts the heavy modal).
  const [createSlot, setCreateSlot] = useState<
    { date: string; time: string; durationMin: number; masterId: number | null; rect: AnchorRect | null } | null
  >(null);

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
      {/* Monolithic calendar — nav header + hour grid in one card so the week
          reads as a single block. The empty state lives below the grid (it was
          previously wedged between the header and the grid). */}
      <div className="glass-card rounded-2xl overflow-hidden" data-testid="week-view-card">
        {/* Header */}
        <div className="p-3 flex items-center justify-between border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white capitalize truncate">{weekLabel}</h2>
            {isLoading && (
              <div className="w-3 h-3 rounded-full border-2 border-brand-500/40 border-t-brand-400 animate-spin shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={goPrev}
              data-testid="week-view-prev"
              className="p-2 rounded-xl text-brand-600 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
              aria-label={t("salon.week.prev", lang)}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={goToday}
              data-testid="week-view-today"
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
            >
              {t("salon.week.thisWeek", lang)}
            </button>
            <button
              onClick={goNext}
              data-testid="week-view-next"
              className="p-2 rounded-xl text-brand-600 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
              aria-label={t("salon.week.next", lang)}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Hour grid + visible day columns (3 on mobile, 7 on desktop) */}
        <div
          ref={scrollerRef}
          className="overflow-auto"
          style={{ maxHeight: "clamp(400px, calc(100dvh - 280px), 90dvh)" }}
        >
        <div
          className="flex"
          style={{ minWidth: 80 + visibleDays.length * colWidth }}
        >
          {/* Hour scale — the sticky left axis must be OPAQUE: day columns
              scroll horizontally behind it, and a translucent gutter let the
              hatched non-working band + grid lines bleed through (ugly seam
              when scrolled right). */}
          <div className="shrink-0 w-20 sticky left-0 z-10 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-white/10">
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
                      dashed half-hour lines + appointment blocks.
                      Calendar overhaul (2026-05-16): wrapped in
                      DragCreateLayer so click/drag opens NewBookingDialog. */}
                  <DragCreateLayer
                    date={iso}
                    masterId={null}
                    hourHeight={HOUR_HEIGHT}
                    hourStart={HOUR_START}
                    hourEnd={HOUR_END}
                    totalHeight={TOTAL_HOURS * HOUR_HEIGHT}
                    onCreateAt={
                      onCreateAt
                        ? (info) =>
                            setCreateSlot({
                              date: info.date,
                              time: info.time,
                              durationMin: info.durationMin,
                              masterId: info.masterId,
                              rect: info.anchorRect ?? null,
                            })
                        : undefined
                    }
                    testIdPrefix="week-view-drag"
                  >
                    {/* Non-working hours — gray diagonal gradient (same look as
                        time-off blocks), driven by salon «Godziny pracy».
                        Rendered first so grid lines + appointments paint over
                        it; pointer-events-none keeps drag-to-create working. */}
                    {workHours && (() => {
                      const dh = workHours[WEEKDAY_KEYS[(day.getDay() + 6) % 7]!] ?? null;
                      return nonWorkingBands(dh).map((b, bi) => (
                        <div
                          key={`nw-${bi}`}
                          data-testid="week-view-non-working"
                          className="absolute left-0 right-0 pointer-events-none"
                          style={{
                            top: b.top,
                            height: b.height,
                            background:
                              "repeating-linear-gradient(45deg, rgba(100,116,139,0.18) 0 6px, rgba(100,116,139,0.06) 6px 12px)",
                          }}
                        />
                      ));
                    })()}
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
                    {(() => {
                    // Google-Calendar-style overlap lanes: bookings sharing a
                    // time window split the column into side-by-side sub-columns
                    // instead of stacking and hiding each other.
                    const laneMap = computeLanes(
                      list.map((a) => {
                        const start = parseHHMMToMinutes(a.time);
                        return { id: a.id, startMin: start, endMin: start + Math.max(15, a.duration ?? 60) };
                      }),
                    );
                    return list.map((a) => {
                      const top = timeToTop(a.time);
                      const height = durationToHeight(a.duration);
                      const placement = laneMap.get(a.id) ?? { lane: 0, lanes: 1 };
                      // Width/offset within the column, in %, leaving a 4% gutter
                      // on the right so the rightmost block doesn't touch the
                      // column border.
                      const laneWidthPct = (100 - 4) / placement.lanes;
                      const laneLeftPct = placement.lane * laneWidthPct;
                      const tone =
                        (typeof a.masterId === "number" && masterColor.get(a.masterId)) || fallbackTone;
                      const isCancelled = !!a.cancelled || a.status === "cancelled" || a.status === "rejected";
                      const isNoShow = !!a.noShow;
                      const isTerminal = isCancelled || isNoShow || a.status === "done";
                      const isDraggingSelf = draggingId === a.id;
                      const baseOpacity = isCancelled || isNoShow ? 0.45 : 1;
                      // While the user drags THIS block, fade the source so
                      // the only visible "real" copy is the ghost.
                      const opacity = isDraggingSelf ? baseOpacity * 0.3 : baseOpacity;
                      // Terminal rows can't be moved (matches the
                      // mutation's guard) — fall back to a plain button.
                      const drag = !isTerminal && onMoveAppointment
                        ? bindBlock({
                            appointmentId: a.id,
                            date: iso,
                            masterId: null,
                            time: a.time,
                            durationMin: a.duration ?? 60,
                          })
                        : null;
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            setSelectedRect({ left: r.left, top: r.top, width: r.width, height: r.height });
                            setSelectedApt(a);
                          }}
                          onPointerDown={drag?.onPointerDown}
                          data-testid="week-view-event"
                          data-apt-id={a.id}
                          className={`absolute rounded-lg px-1.5 py-1 text-left transition-shadow hover:shadow-lg overflow-hidden ${
                            drag ? "cursor-grab active:cursor-grabbing" : ""
                          }`}
                          style={{
                            top,
                            height,
                            // Lane geometry — side-by-side when overlapping,
                            // full width (minus gutter) when alone.
                            left: `calc(${laneLeftPct}% + 2px)`,
                            width: `calc(${laneWidthPct}% - 2px)`,
                            background: tone.bg,
                            borderLeft: `3px solid ${tone.border}`,
                            opacity,
                            ...(drag?.style ?? {}),
                          }}
                          title={`${a.time} ${a.userName ?? ""}`.trim()}
                        >
                          <div className="text-[9px] font-bold tabular-nums" style={{ color: tone.text }}>
                            {a.time}
                          </div>
                          <div className="text-[10px] font-medium text-slate-800 dark:text-white truncate leading-tight">
                            {a.userName ?? a.userTg ?? `#${a.chatId ?? ""}`}
                          </div>
                          {(a.serviceName ?? a.svcId) && placement.lanes <= 2 && (
                            <div className="text-[9px] text-slate-500 dark:text-slate-400 truncate leading-tight">
                              {a.serviceName ?? a.svcId}
                            </div>
                          )}
                        </button>
                      );
                    });
                    })()}

                    {/* Drag-to-reschedule ghost — rendered in the column
                        currently under the cursor, NOT necessarily the
                        source column. The hook commits the new (date,
                        masterId, time) on pointerup. */}
                    {moveGhost && moveGhost.date === iso && (
                      <div
                        aria-hidden
                        data-testid="week-view-move-ghost"
                        className="absolute left-1 right-1 rounded-lg border-2 border-dashed pointer-events-none flex flex-col items-center justify-center text-[10px] font-bold text-brand-700 dark:text-brand-100"
                        style={{
                          top: moveGhost.top,
                          height: moveGhost.height,
                          background: "rgba(124,58,237,0.22)",
                          borderColor: "rgba(124,58,237,0.7)",
                          zIndex: 30,
                        }}
                      >
                        <span className="tabular-nums leading-none">
                          {`${String(Math.floor(moveGhost.startMin / 60)).padStart(2, "0")}:${String(moveGhost.startMin % 60).padStart(2, "0")}`}
                        </span>
                      </div>
                    )}

                    {/* Blocks (reservation / time_off) — calendar overhaul.
                        Stacked with appointments; multiple masters' blocks
                        in the same time window simply layer up. */}
                    {(blocksByDate.get(iso) ?? []).map((b) => {
                      const isMultiDay = !!b.endDate && b.endDate !== iso;
                      const top = isMultiDay ? 0 : timeToTop(b.time);
                      const height = isMultiDay
                        ? TOTAL_HOURS * HOUR_HEIGHT
                        : Math.max(HOUR_HEIGHT * 0.5, (b.durationMin / 60) * HOUR_HEIGHT);
                      return (
                        <button
                          type="button"
                          key={b.id}
                          data-testid="week-view-block"
                          data-block-id={b.id}
                          data-block-type={b.type}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!onDeleteBlock) return;
                            if (typeof window !== "undefined" && window.confirm(t("common.deleteConfirm", lang))) {
                              onDeleteBlock(b.id);
                            }
                          }}
                          className="absolute left-1 right-1 rounded-lg px-1.5 py-1 text-left overflow-hidden border border-dashed flex items-center gap-1 hover:opacity-80 transition-opacity"
                          style={{
                            top,
                            height,
                            background:
                              "repeating-linear-gradient(45deg, rgba(100,116,139,0.18) 0 6px, rgba(100,116,139,0.06) 6px 12px)",
                            borderColor: "rgba(100,116,139,0.6)",
                            color: "#475569",
                          }}
                          title={b.reason ?? (b.type === "reservation" ? "Резерв" : "Перерыв / выходной")}
                        >
                          <Lock className="h-2.5 w-2.5 shrink-0" />
                          <span className="text-[9px] font-medium truncate">{b.reason ?? (b.type === "reservation" ? "Reserved" : "Time off")}</span>
                        </button>
                      );
                    })}
                  </DragCreateLayer>
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
      </div>

      {/* Empty state — below the calendar so the week grid reads as one
          monolithic block (previously wedged between header and grid). */}
      {aptsByDate.size === 0 && !isLoading && (
        <div className="glass-card rounded-2xl py-12 px-4 text-center" data-testid="week-view-empty">
          <CalendarDays className="h-8 w-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("salon.cal.noUpcoming", lang)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("salon.empty.apts", lang)}</p>
        </div>
      )}

      {/* Selected apt drawer — rich AppointmentDetailPanel (status actions,
          reschedule, «Профиль клиента») when the parent supplies tenantId +
          services; otherwise the legacy AptCard fallback (God-Mode page). */}
      {selectedApt && tenantId && services ? (
        <AppointmentDetailPanel
          tenantId={tenantId}
          selected={
            {
              id: selectedApt.id,
              tenantId,
              date: selectedApt.date,
              time: selectedApt.time,
              duration: typeof selectedApt.duration === "number" ? selectedApt.duration : null,
              status: selectedApt.status,
              cancelled: selectedApt.cancelled ?? null,
              noShow: selectedApt.noShow ?? null,
              noShowBy: selectedApt.noShowBy ?? null,
              cancelledBy: selectedApt.cancelledBy ?? null,
              cancelReason: selectedApt.cancelReason ?? null,
              masterId: selectedApt.masterId ?? null,
              svcId: selectedApt.svcId ?? null,
              userName: selectedApt.userName ?? null,
              userPhone: selectedApt.userPhone ?? null,
              userTg: selectedApt.userTg ?? null,
              chatId: selectedApt.chatId ?? null,
            } satisfies SelectedAppointment
          }
          masters={masters.map((m) => ({ chatId: m.chatId, name: m.name }))}
          services={services}
          lang={lang}
          anchorRect={selectedRect}
          onClose={() => setSelectedApt(null)}
          onChanged={() => {
            onUpdated?.();
            setSelectedApt(null);
          }}
        />
      ) : selectedApt ? (
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
      ) : null}

      {createSlot && (
        <CreateSlotPopover
          anchorRect={createSlot.rect}
          date={createSlot.date}
          time={createSlot.time}
          durationMin={createSlot.durationMin}
          lang={lang}
          onCreate={() => {
            onCreateAt?.({
              date: createSlot.date,
              masterId: createSlot.masterId,
              time: createSlot.time,
              durationMin: createSlot.durationMin,
              modifier: "none",
            });
            setCreateSlot(null);
          }}
          onReserve={() => {
            onCreateAt?.({
              date: createSlot.date,
              masterId: createSlot.masterId,
              time: createSlot.time,
              durationMin: createSlot.durationMin,
              modifier: "shift",
            });
            setCreateSlot(null);
          }}
          onClose={() => setCreateSlot(null)}
        />
      )}
    </div>
  );
}
