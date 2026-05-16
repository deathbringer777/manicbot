"use client";

/**
 * SalonDayView — single-day hour-grid with one column per master.
 *
 * Built per §12.1 of the Booksy comparison plan. Google Calendar / Booksy
 * mash-up in our brand colors:
 *
 *  ┌──────┬─────── master A ─────── master B ─────── master C ──┐
 *  │ 8:00 │  [hatched non-working]                              │
 *  │ 9:00 │ ┌───────────┐                                       │
 *  │ 10:00│ │  Anna     │                                       │
 *  │ ──── │ │  manicure │ ┌───────────┐  ← red current-time line│
 *  │ 11:00│ └───────────┘ │  Olga     │                         │
 *  │ ...                                                        │
 *  └────────────────────────────────────────────────────────────┘
 *
 * Each appointment is positioned absolutely within its master column based
 * on start time + duration. Color is auto-assigned per master from a brand
 * palette (so the same master always renders in the same hue).
 *
 * Read-only on first ship — clicking a block opens the existing AptCard
 * action set in a side drawer. Drag-reschedule, FAB sub-actions, .ics
 * import etc. are tracked as P0 follow-ups in §12.7 of the plan.
 */

import { useMemo, useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, Users, Eye, EyeOff, Lock } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { AptCard } from "~/components/dashboard-ui/AptCard";
import { DragCreateLayer } from "~/components/calendar/DragCreateLayer";
import type { DragGhost } from "~/lib/calendar/useDragToCreate";

const VISIBLE_MASTERS_KEY = "manicbot_day_view_visible_masters";
const HOUR_HEIGHT = 56;
const HOUR_START = 8; // 08:00
const HOUR_END = 22; // 22:00 (exclusive — last visible row is 21:00–22:00)
const TOTAL_HOURS = HOUR_END - HOUR_START;

/** Brand-derived palette — assigned to master columns by index. Each tone
 *  has enough contrast against both light and dark surfaces. */
const MASTER_PALETTE = [
  { bg: "rgba(124,58,237,0.18)", border: "rgba(124,58,237,0.55)", text: "#7c3aed" }, // brand purple
  { bg: "rgba(11,155,107,0.18)", border: "rgba(11,155,107,0.55)", text: "#0b9b6b" }, // accent green
  { bg: "rgba(6,182,212,0.18)",  border: "rgba(6,182,212,0.55)",  text: "#0891b2" }, // cyan
  { bg: "rgba(244,114,182,0.18)", border: "rgba(244,114,182,0.55)", text: "#ec4899" }, // pink
  { bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.55)", text: "#d97706" }, // amber
  { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.55)", text: "#2563eb" }, // blue
  { bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.55)", text: "#9333ea" }, // violet
  { bg: "rgba(20,184,166,0.18)", border: "rgba(20,184,166,0.55)", text: "#0d9488" }, // teal
] as const;

interface MasterRow {
  chatId: number;
  name: string | null;
  /** D1 stores `work_hours` as TEXT — accept any shape; parsed lazily. */
  workHours?: unknown;
}

/**
 * Loose row type — the Drizzle schema row shape is wider (43+ fields) and
 * uses `integer | null` for booleans + nullable strings everywhere. Same
 * loosen-everything approach as SalonAgendaView so consumers don't need
 * to massage the shape before passing it in.
 */
type AptRow = Record<string, any> & {
  id: number | string;
  date: string;
  time: string;
  status: string;
};

/**
 * Calendar overhaul (2026-05-16): rows from `appointment_blocks` (master
 * reservations + time-off bands). Rendered inside the same master columns
 * as appointments but with a hatched grey visual + lock icon + no client
 * column. Click → caller-supplied `onDeleteBlock` confirmation.
 */
export interface DayViewBlock {
  id: string;
  date: string;             // YYYY-MM-DD
  time: string;             // HH:MM
  durationMin: number;
  endDate?: string | null;  // multi-day time_off; date <= endDate covers fully
  masterId: number;
  type: "reservation" | "time_off";
  reason?: string | null;
}

interface Props {
  date: Date;
  setDate: (d: Date) => void;
  apts: AptRow[];
  masters: MasterRow[];
  isLoading: boolean;
  lang: Lang;
  onAction?: (id: number | string, status: "confirmed" | "cancelled" | "rejected") => void;
  onNoShow?: (id: number | string, noShowBy: "client" | "master") => void;
  /**
   * Master-visibility filter. When the parent owns the state (e.g. shares
   * it with CalendarLeftRail), pass the Set + toggle in. When omitted,
   * the view falls back to its own internal localStorage-backed state
   * + an inline horizontal rail for backwards compatibility.
   */
  hiddenMasterIds?: Set<number>;
  toggleMasterVisible?: (chatId: number) => void;
  showAllMasters?: () => void;
  /** Calendar overhaul (2026-05-16) — block rendering + drag-to-create. */
  blocks?: DayViewBlock[];
  onCreateAt?: (info: { date: string; masterId: number | null; time: string; durationMin: number; modifier: DragGhost["modifier"] }) => void;
  onDeleteBlock?: (id: string) => void;
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

/** Convert a HH:MM time on the visible day into an absolute pixel offset. */
function timeToTop(hhmm: string): number {
  const minutes = parseHHMMToMinutes(hhmm);
  const start = HOUR_START * 60;
  return ((minutes - start) / 60) * HOUR_HEIGHT;
}

function durationToHeight(durationMin: number | null | undefined): number {
  const d = Math.max(15, durationMin ?? 60); // minimum visible height = 15min slot
  return (d / 60) * HOUR_HEIGHT;
}

/**
 * Resolve a master's working window for the given day-of-week.
 *
 * `work_hours` is stored as TEXT in D1 and historically can be:
 *   1. JSON {from, to} — a single window applied to every day (legacy).
 *   2. JSON {mon, tue, …, sun} where each value is "HH:MM-HH:MM" — per-day
 *      windows. A missing key means closed for that day.
 *   3. A plain "09:00-18:00" string — single window applied to every day.
 *   4. null / undefined — unknown; treat as fully open (don't hatch).
 *
 * Returns null when fully open (case 4 or no data) or `{startMin, endMin}`
 * relative to midnight when the master IS working that day. Returns
 * `{closed: true}` when explicitly closed for that day.
 */
function getMasterWorkRange(
  workHoursRaw: unknown,
  dayOfWeek: number, // 0=Sun … 6=Sat (JS Date.getDay)
): { closed: true } | { startMin: number; endMin: number } | null {
  if (workHoursRaw == null) return null;
  let parsed: unknown = workHoursRaw;
  if (typeof workHoursRaw === "string") {
    const trimmed = workHoursRaw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Single-window string like "09:00-18:00".
        return parseRangeString(trimmed);
      }
    } else {
      return parseRangeString(trimmed);
    }
  }
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    // Case 1: {from, to}
    if ("from" in obj && "to" in obj) {
      const f = obj.from;
      const t = obj.to;
      const startMin =
        typeof f === "number" ? f * 60 : parseHHMMToMinutes(typeof f === "string" ? f : undefined);
      const endMin =
        typeof t === "number" ? t * 60 : parseHHMMToMinutes(typeof t === "string" ? t : undefined);
      if (endMin > startMin) return { startMin, endMin };
      return null;
    }
    // Case 2: per-day map
    const KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][dayOfWeek]!;
    const dayValue = obj[KEY];
    if (dayValue == null || dayValue === "" || dayValue === false) {
      return { closed: true };
    }
    if (typeof dayValue === "string") {
      return parseRangeString(dayValue);
    }
    if (typeof dayValue === "object" && dayValue !== null) {
      const inner = dayValue as Record<string, unknown>;
      const f = inner.from ?? inner.start;
      const t = inner.to ?? inner.end;
      const startMin =
        typeof f === "number" ? f * 60 : parseHHMMToMinutes(typeof f === "string" ? f : undefined);
      const endMin =
        typeof t === "number" ? t * 60 : parseHHMMToMinutes(typeof t === "string" ? t : undefined);
      if (endMin > startMin) return { startMin, endMin };
      return { closed: true };
    }
    return null;
  }
  return null;
}

function parseRangeString(s: string): { startMin: number; endMin: number } | { closed: true } | null {
  const m = s.match(/(\d{1,2}):?(\d{2})\s*[-–—]\s*(\d{1,2}):?(\d{2})/);
  if (!m) return null;
  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (endMin > startMin) return { startMin, endMin };
  return null;
}

export function SalonDayView({
  date,
  setDate,
  apts,
  masters,
  isLoading,
  lang,
  onAction,
  onNoShow,
  hiddenMasterIds: hiddenMasterIdsProp,
  toggleMasterVisible: toggleMasterVisibleProp,
  showAllMasters: showAllMastersProp,
  blocks,
  onCreateAt,
  onDeleteBlock,
}: Props) {
  const isoDate = fmtIsoDate(date);
  const [selectedApt, setSelectedApt] = useState<AptRow | null>(null);
  const todayIso = fmtIsoDate(new Date());
  const isToday = isoDate === todayIso;
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Mobile scroll indicator — tracks which master column is currently most
  // visible in the horizontal scroll container.
  const [activeColIdx, setActiveColIdx] = useState(0);

  // Master-visibility state. Source-of-truth precedence:
  //   1. props from the parent (CalendarLeftRail shares the same hook),
  //   2. fallback internal state for legacy callers that don't pass props.
  // The internal fallback persists to localStorage under the same key so
  // a future external owner inherits the saved choice.
  const [internalHidden, setInternalHidden] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = localStorage.getItem(VISIBLE_MASTERS_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set<number>(Array.isArray(arr) ? arr.filter((x) => typeof x === "number") : []);
    } catch {
      return new Set();
    }
  });
  const hiddenMasterIds = hiddenMasterIdsProp ?? internalHidden;
  const toggleMasterVisible =
    toggleMasterVisibleProp ??
    ((chatId: number) => {
      setInternalHidden((prev) => {
        const next = new Set(prev);
        if (next.has(chatId)) next.delete(chatId);
        else next.add(chatId);
        try {
          localStorage.setItem(VISIBLE_MASTERS_KEY, JSON.stringify(Array.from(next)));
        } catch {
          /* noop */
        }
        return next;
      });
    });
  const showAllMasters =
    showAllMastersProp ??
    (() => {
      setInternalHidden(new Set());
      try {
        localStorage.setItem(VISIBLE_MASTERS_KEY, "[]");
      } catch {
        /* noop */
      }
    });
  // Hide the inline horizontal rail when the parent owns the state — it
  // means there's a `CalendarLeftRail` rendering its own master section.
  const showInlineRail = hiddenMasterIdsProp === undefined;

  // Auto-scroll to current time when viewing today (delayed so layout settles).
  useEffect(() => {
    if (!isToday || !scrollerRef.current) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const offset = ((minutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
    if (offset < 0) return;
    const t = window.setTimeout(() => {
      scrollerRef.current?.scrollTo({ top: Math.max(0, offset - HOUR_HEIGHT * 1.5), behavior: "smooth" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [isToday]);

  // Filter apts for this day, group by masterId.
  const aptsByMaster = useMemo(() => {
    const m = new Map<number | "unassigned", AptRow[]>();
    for (const a of apts) {
      if (a.date !== isoDate) continue;
      const key: number | "unassigned" = (a.masterId ?? "unassigned") as number | "unassigned";
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return m;
  }, [apts, isoDate]);

  // Group blocks for this day, by masterId. A block is "on" this day if
  // either:
  //   * single-day row → date === isoDate
  //   * multi-day time_off row → date <= isoDate AND endDate >= isoDate
  const blocksByMaster = useMemo(() => {
    const m = new Map<number, DayViewBlock[]>();
    for (const b of blocks ?? []) {
      const inRange = b.endDate
        ? b.date <= isoDate && b.endDate >= isoDate
        : b.date === isoDate;
      if (!inRange) continue;
      const arr = m.get(b.masterId) ?? [];
      arr.push(b);
      m.set(b.masterId, arr);
    }
    return m;
  }, [blocks, isoDate]);

  // ALL columns (used by the rail to show every master, even hidden ones).
  const allMasterColumns = useMemo(() => {
    const cols = masters.map((m, idx) => ({
      master: m,
      tone: MASTER_PALETTE[idx % MASTER_PALETTE.length]!,
      apts: aptsByMaster.get(m.chatId) ?? [],
    }));
    const unassigned = aptsByMaster.get("unassigned") ?? [];
    if (unassigned.length > 0) {
      cols.push({
        master: { chatId: -1, name: t("salon.day.unassigned", lang) },
        tone: MASTER_PALETTE[masters.length % MASTER_PALETTE.length]!,
        apts: unassigned,
      });
    }
    return cols;
  }, [masters, aptsByMaster, lang]);

  // VISIBLE columns (filtered through hiddenMasterIds — what actually
  // renders in the grid). Unassigned column always renders if it has
  // appointments (can't be filtered — those aren't yet assigned).
  const masterColumns = useMemo(
    () => allMasterColumns.filter((c) => c.master.chatId === -1 || !hiddenMasterIds.has(c.master.chatId as number)),
    [allMasterColumns, hiddenMasterIds],
  );

  // Mobile column width — matches the min-w-[100px] Tailwind class on each column.
  const MOBILE_COL_WIDTH = 100;

  // Horizontal scroll handler for the mobile dot indicator.
  // `masterColumns` is in scope here (defined above).
  const handleGridScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const sl = e.currentTarget.scrollLeft;
    const idx = Math.min(
      masterColumns.length - 1,
      Math.max(0, Math.floor(sl / MOBILE_COL_WIDTH)),
    );
    setActiveColIdx(idx);
  };

  const locale =
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU";
  const dayLabel = date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });

  const goPrev = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    setDate(d);
  };
  const goNext = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(d);
  };
  const goToday = () => setDate(new Date());

  // Current-time red line — only on today, only inside visible range.
  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    if (!isToday) return;
    const interval = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [isToday]);
  const currentTimeTop = ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const currentTimeVisible = isToday && nowMinutes >= HOUR_START * 60 && nowMinutes < HOUR_END * 60;

  return (
    <div className="space-y-3" data-testid="salon-day-view">
      {/* Header — date nav + today shortcut */}
      <div className="glass-card rounded-2xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white capitalize truncate">{dayLabel}</h2>
          {isLoading && (
            <div className="w-3 h-3 rounded-full border-2 border-brand-500/40 border-t-brand-400 animate-spin shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goPrev}
            data-testid="day-view-prev"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            aria-label={t("salon.day.prev", lang)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            data-testid="day-view-today"
            className="px-2 py-1 rounded-lg text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            {t("salon.cal.todaySmall", lang)}
          </button>
          <button
            onClick={goNext}
            data-testid="day-view-next"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors"
            aria-label={t("salon.day.next", lang)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* My Calendars rail — per-master visibility toggle.
          Inline rail rendered ONLY when the parent doesn't already render
          its own (e.g. via CalendarLeftRail). Backwards-compat fallback. */}
      {showInlineRail && allMasterColumns.length > 0 && (
        <div
          className="glass-card rounded-2xl p-3 hidden sm:flex items-center gap-2 flex-wrap"
          data-testid="day-view-master-rail"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1">
            {t("salon.day.myCalendars", lang)}
          </span>
          {allMasterColumns.map(({ master, tone }) => {
            if (master.chatId === -1) return null; // unassigned — not toggleable
            const visible = !hiddenMasterIds.has(master.chatId as number);
            return (
              <button
                key={master.chatId}
                type="button"
                onClick={() => toggleMasterVisible(master.chatId as number)}
                data-testid="day-view-master-toggle"
                data-master-id={master.chatId}
                data-visible={visible ? "1" : "0"}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] font-medium transition-colors ${
                  visible
                    ? "border-transparent text-slate-700 dark:text-slate-200"
                    : "border-slate-300 dark:border-white/10 text-slate-400 dark:text-slate-500 line-through"
                }`}
                style={visible ? { background: tone.bg, borderColor: tone.border } : undefined}
                title={visible ? t("salon.day.hideMaster", lang) : t("salon.day.showMaster", lang)}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: visible ? tone.text : "transparent", border: visible ? "none" : `1.5px solid ${tone.text}` }}
                />
                <span className="truncate max-w-[120px]">{master.name ?? `#${master.chatId}`}</span>
                {visible ? <Eye className="h-3 w-3 opacity-60" /> : <EyeOff className="h-3 w-3 opacity-60" />}
              </button>
            );
          })}
          {hiddenMasterIds.size > 0 && (
            <button
              type="button"
              onClick={showAllMasters}
              data-testid="day-view-show-all-masters"
              className="ml-auto text-[10px] font-medium text-brand-500 dark:text-brand-400 hover:text-brand-600 dark:hover:text-brand-300 underline-offset-2 hover:underline"
            >
              {t("salon.day.showAll", lang)}
            </button>
          )}
        </div>
      )}

      {/* Empty state — no masters */}
      {masterColumns.length === 0 && (
        <div className="glass-card rounded-2xl py-12 px-4 text-center" data-testid="day-view-empty">
          <Users className="h-8 w-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("salon.day.noMasters", lang)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("salon.empty.masters", lang)}</p>
        </div>
      )}

      {/* Mobile scroll indicator — dots, one per visible master column.
          Tapping a dot scrolls the grid to that column. Hidden on sm+. */}
      {masterColumns.length > 1 && (
        <div className="flex items-center justify-center gap-2 sm:hidden" aria-hidden>
          {masterColumns.map(({ master, tone }, i) => (
            <button
              key={master.chatId}
              type="button"
              onClick={() => {
                scrollerRef.current?.scrollTo({
                  left: i * MOBILE_COL_WIDTH,
                  behavior: "smooth",
                });
                setActiveColIdx(i);
              }}
              className="rounded-full transition-all focus:outline-none"
              style={{
                height: 6,
                width: i === activeColIdx ? 20 : 6,
                background: i === activeColIdx ? tone.text : tone.border,
                opacity: i === activeColIdx ? 1 : 0.45,
              }}
              title={master.name ?? `#${master.chatId}`}
            />
          ))}
        </div>
      )}

      {/* Hour grid + master columns */}
      {masterColumns.length > 0 && (
        <div
          ref={scrollerRef}
          onScroll={handleGridScroll}
          className="glass-card rounded-2xl overflow-auto"
          style={{ maxHeight: "calc(100vh - 280px)" }}
        >
          {/* minWidth uses 100px per column (mobile-safe). On sm+ screens,
              sm:min-w-[180px] on each column expands them via flex. */}
          <div className="flex" style={{ minWidth: 80 + masterColumns.length * MOBILE_COL_WIDTH }}>
            {/* Hour scale */}
            <div className="shrink-0 w-20 sticky left-0 z-10 bg-white/95 dark:bg-slate-900/80 backdrop-blur-sm border-r border-slate-200 dark:border-white/10">
              <div className="h-12 border-b border-slate-200 dark:border-white/10" />
              {Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i).map((h) => (
                <div
                  key={h}
                  className="text-[10px] text-slate-400 dark:text-slate-500 text-right pr-2 border-b border-slate-200 dark:border-white/10"
                  style={{ height: HOUR_HEIGHT }}
                >
                  <span className="relative -top-1.5">{pad(h)}:00</span>
                </div>
              ))}
            </div>

            {/* Master columns */}
            <div className="flex-1 flex relative">
              {masterColumns.map(({ master, tone, apts: list }, idx) => (
                <div
                  key={master.chatId}
                  className="flex-1 min-w-[100px] sm:min-w-[180px] border-r border-slate-200 dark:border-white/10 last:border-r-0 relative"
                  data-testid="day-view-master-column"
                  data-master-id={master.chatId}
                >
                  {/* Header */}
                  <div className="h-12 flex items-center gap-2 px-3 border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/40 sticky top-0 z-10 backdrop-blur-sm">
                    <span
                      className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                      style={{ background: tone.text }}
                    >
                      {(master.name ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {master.name ?? `#${master.chatId}`}
                    </span>
                  </div>

                  {/* Body — Google-Calendar-style ruled grid (solid hour lines
                      + dashed half-hour lines) + flat non-working tint.
                      Calendar overhaul (2026-05-16): wrapped in DragCreateLayer
                      so click/drag inside the empty grid opens NewBookingDialog. */}
                  <DragCreateLayer
                    date={isoDate}
                    masterId={master.chatId === -1 ? null : (master.chatId as number)}
                    hourHeight={HOUR_HEIGHT}
                    hourStart={HOUR_START}
                    hourEnd={HOUR_END}
                    totalHeight={TOTAL_HOURS * HOUR_HEIGHT}
                    onCreateAt={master.chatId === -1 ? undefined : onCreateAt}
                    testIdPrefix="day-view-drag"
                  >
                    {/* Non-working hours — flat darker tint (rendered first,
                        below grid lines + appointments). Skipped for the
                        synthetic Unassigned column. */}
                    {(() => {
                      if (master.chatId === -1) return null;
                      const range = getMasterWorkRange(
                        (master as MasterRow).workHours,
                        date.getDay(),
                      );
                      if (range === null) return null;
                      const dayStart = HOUR_START * 60;
                      const dayEnd = HOUR_END * 60;
                      const tintClass =
                        "absolute left-0 right-0 pointer-events-none bg-slate-100/60 dark:bg-slate-950/40";
                      if ("closed" in range) {
                        return (
                          <div
                            data-testid="day-view-non-working"
                            className={tintClass}
                            style={{ top: 0, height: TOTAL_HOURS * HOUR_HEIGHT }}
                          />
                        );
                      }
                      const startVis = Math.max(range.startMin, dayStart);
                      const endVis = Math.min(range.endMin, dayEnd);
                      const beforeHeight = ((startVis - dayStart) / 60) * HOUR_HEIGHT;
                      const afterTop = ((endVis - dayStart) / 60) * HOUR_HEIGHT;
                      const afterHeight = TOTAL_HOURS * HOUR_HEIGHT - afterTop;
                      return (
                        <>
                          {beforeHeight > 0 && (
                            <div
                              data-testid="day-view-non-working"
                              className={tintClass}
                              style={{ top: 0, height: beforeHeight }}
                            />
                          )}
                          {afterHeight > 0 && (
                            <div
                              data-testid="day-view-non-working"
                              className={tintClass}
                              style={{ top: afterTop, height: afterHeight }}
                            />
                          )}
                        </>
                      );
                    })()}

                    {/* Grid lines — solid at every hour, dashed at every
                        half-hour. Drawn over the non-working tint so the
                        ruled-paper effect stays visible everywhere. */}
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => i).map((i) => (
                      <div key={`h-${i}`}>
                        {/* Solid hour line — skip the very first to avoid
                            doubling the column-header bottom border. */}
                        {i > 0 && (
                          <div
                            className="absolute left-0 right-0 border-t border-slate-200 dark:border-white/[0.08] pointer-events-none"
                            style={{ top: i * HOUR_HEIGHT }}
                          />
                        )}
                        {/* Dashed half-hour line */}
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-slate-100 dark:border-white/[0.04] pointer-events-none"
                          style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                        />
                      </div>
                    ))}

                    {/* Appointment blocks */}
                    {list.map((a) => {
                      const top = timeToTop(a.time);
                      const height = durationToHeight(a.duration);
                      const isCancelled = !!a.cancelled || a.status === "cancelled" || a.status === "rejected";
                      const isNoShow = !!a.noShow;
                      const opacity = isCancelled || isNoShow ? 0.45 : 1;
                      const isSelected = selectedApt?.id === a.id;
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={(e) => { e.stopPropagation(); setSelectedApt(a); }}
                          data-testid="day-view-event"
                          data-apt-id={a.id}
                          data-selected={isSelected ? "1" : "0"}
                          className={`absolute left-1 right-1 rounded-lg px-2 py-1 text-left transition-all overflow-hidden ring-1 ring-transparent hover:ring-slate-300 dark:hover:ring-white/20 hover:-translate-y-px hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                            isSelected ? "ring-2 ring-offset-1 shadow-md" : ""
                          }`}
                          style={{
                            top,
                            height,
                            background: tone.bg,
                            borderLeft: `3px solid ${tone.border}`,
                            opacity,
                          }}
                          title={`${a.time} ${a.userName ?? ""}`.trim()}
                        >
                          <div className="text-[10px] font-bold tabular-nums" style={{ color: tone.text }}>
                            {a.time}
                          </div>
                          <div className={`text-[11px] font-medium text-slate-800 dark:text-white truncate leading-tight ${
                            isCancelled || isNoShow ? "line-through" : ""
                          }`}>
                            {a.userName ?? a.userTg ?? `#${a.chatId ?? ""}`}
                          </div>
                          {a.svcId && height >= HOUR_HEIGHT * 0.75 && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {a.svcId}
                            </div>
                          )}
                        </button>
                      );
                    })}

                    {/* Blocks (reservation / time_off) — calendar overhaul.
                        Hatched grey fill, lock icon, no client column. Click
                        opens a small inline confirm; on confirm calls
                        `onDeleteBlock` to soft-cancel the row. */}
                    {(blocksByMaster.get(master.chatId as number) ?? []).map((b) => {
                      const isMultiDay = !!b.endDate && b.endDate !== isoDate;
                      const top = isMultiDay ? 0 : timeToTop(b.time);
                      const height = isMultiDay
                        ? TOTAL_HOURS * HOUR_HEIGHT
                        : Math.max(HOUR_HEIGHT * 0.5, (b.durationMin / 60) * HOUR_HEIGHT);
                      return (
                        <button
                          type="button"
                          key={b.id}
                          data-testid="day-view-block"
                          data-block-id={b.id}
                          data-block-type={b.type}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!onDeleteBlock) return;
                            // Lightweight inline confirm — keeps the day view
                            // self-contained without a global confirm modal.
                            if (typeof window !== "undefined" && window.confirm(t("common.deleteConfirm", lang))) {
                              onDeleteBlock(b.id);
                            }
                          }}
                          className="absolute left-1 right-1 rounded-lg px-2 py-1 text-left overflow-hidden border border-dashed flex flex-col gap-0.5 hover:opacity-80 transition-opacity"
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
                          <div className="flex items-center gap-1 text-[10px] font-bold tabular-nums">
                            <Lock className="h-3 w-3" />
                            {!isMultiDay && <span>{b.time}</span>}
                          </div>
                          <div className="text-[10px] font-medium text-slate-700 dark:text-slate-200 truncate">
                            {b.reason ?? (b.type === "reservation" ? "Reserved" : "Time off")}
                          </div>
                        </button>
                      );
                    })}
                  </DragCreateLayer>
                </div>
              ))}

              {/* Current-time red line — spans all columns */}
              {currentTimeVisible && (
                <div
                  data-testid="day-view-now-line"
                  className="absolute left-0 right-0 pointer-events-none z-20"
                  style={{ top: 48 + currentTimeTop }} // 48 = column header height
                >
                  <div className="h-px bg-red-500/80" />
                  <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Selected appointment — bottom drawer */}
      {selectedApt && (
        <div
          className="glass-card rounded-2xl p-4 space-y-3"
          data-testid="day-view-selected"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {selectedApt.time}
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
