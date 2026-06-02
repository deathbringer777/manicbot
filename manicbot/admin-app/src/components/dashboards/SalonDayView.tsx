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
import { useNowTicker } from "~/lib/useNowTicker";
import { AptCard } from "~/components/dashboard-ui/AptCard";
import { AppointmentDetailPanel, type SelectedAppointment } from "~/components/dashboard-ui/AppointmentDetailPanel";
import type { AnchorRect } from "~/lib/calendar/useAnchoredPosition";
import { ConfirmDialog } from "~/components/ui/ConfirmDialog";
import { DragCreateLayer } from "~/components/calendar/DragCreateLayer";
import { CreateSlotPopover } from "~/components/calendar/CreateSlotPopover";
import type { DragGhost } from "~/lib/calendar/useDragToCreate";
import { useDragToMove, type MoveCommit } from "~/lib/calendar/useDragToMove";
import { computeLanes } from "~/lib/calendar/overlapLanes";

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
  /** Drag-to-reschedule: fires when the user drops a block on a new slot.
   *  Day view supports cross-master drag (drop on a different master's
   *  column reassigns the booking). */
  onMoveAppointment?: (move: MoveCommit) => void;
  /**
   * Rich detail panel — when `tenantId` + `services` are provided the
   * bottom drawer becomes `<AppointmentDetailPanel/>` with read/edit
   * modes. Without them, the view falls back to the legacy `AptCard`
   * inline view (status-only actions, no edit). `onUpdated` lets the
   * parent refetch apts after a save / status change / delete.
   */
  tenantId?: string;
  services?: Array<{ svcId: string; names?: string | null; duration: number; price: number }>;
  onUpdated?: () => void;
  /**
   * Single-column mode — used by the master "Расписание" tab where the
   * grid is scoped to one master (this master). In single-column mode:
   *   - the per-column avatar+name header strip is suppressed (the
   *     master knows whose calendar they're looking at — showing
   *     "?" + "#10968255038" for synthetic ids is pure noise);
   *   - an empty-state overlay is rendered inside the grid when the
   *     visible day has zero appointments AND zero blocks;
   *   - auto-scroll-to-now is skipped when the day is empty so the
   *     master sees from `HOUR_START` (working hours start) instead
   *     of landing on a blank "current time" 14h into the day.
   * Default `false` preserves the existing multi-master owner-side
   * behavior in SalonDashboard.
   */
  singleColumnMode?: boolean;
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
  onMoveAppointment,
  tenantId,
  services,
  onUpdated,
  singleColumnMode = false,
}: Props) {
  // Drag-to-reschedule — single hook owns the cross-column ghost state.
  // Both the date+master pair are resolved from the column under the
  // cursor, so dropping on a different master's column reassigns the
  // booking server-side via newMasterId.
  const { ghost: moveGhost, draggingId, bindBlock } = useDragToMove({
    hourHeight: HOUR_HEIGHT,
    hourStart: HOUR_START,
    hourEnd: HOUR_END,
    onCommit: (c) => onMoveAppointment?.(c),
  });
  const isoDate = fmtIsoDate(date);
  const [selectedApt, setSelectedApt] = useState<AptRow | null>(null);
  // Viewport rect of the clicked block — anchors the detail popover (GCal style).
  const [selectedRect, setSelectedRect] = useState<AnchorRect | null>(null);
  // Pending empty-slot drag → quick-create popover (intercepts the heavy modal).
  const [createSlot, setCreateSlot] = useState<
    { date: string; time: string; durationMin: number; masterId: number | null; rect: AnchorRect | null } | null
  >(null);
  const [blockToDelete, setBlockToDelete] = useState<string | null>(null);
  const todayIso = fmtIsoDate(new Date());
  const isToday = isoDate === todayIso;
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Single now-ticker for both the red marker line and past-event dimming.
  // 60s cadence — the grid resolution is minutes, no point ticking faster.
  const nowMs = useNowTicker(60_000);

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
  // In single-column (master self-view) mode, skip the scroll when the day is
  // empty — scrolling a blank grid 14h forward looks like "where did my
  // calendar go?" instead of an inviting empty state. Multi-master owner mode
  // keeps the existing behavior.
  const hasContentToday = useMemo(() => {
    if (apts.some((a) => a.date === isoDate)) return true;
    if ((blocks ?? []).some((b) => (b.endDate ? b.date <= isoDate && b.endDate >= isoDate : b.date === isoDate))) return true;
    return false;
  }, [apts, blocks, isoDate]);
  useEffect(() => {
    if (!isToday || !scrollerRef.current) return;
    if (singleColumnMode && !hasContentToday) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const offset = ((minutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
    if (offset < 0) return;
    const t = window.setTimeout(() => {
      scrollerRef.current?.scrollTo({ top: Math.max(0, offset - HOUR_HEIGHT * 1.5), behavior: "smooth" });
    }, 100);
    return () => window.clearTimeout(t);
  }, [isToday, singleColumnMode, hasContentToday]);

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
  // Sourced from useNowTicker so red line + past-event dimming move in lockstep.
  const nowDate = useMemo(() => new Date(nowMs), [nowMs]);
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
  const currentTimeTop = ((nowMinutes - HOUR_START * 60) / 60) * HOUR_HEIGHT;
  const currentTimeVisible = isToday && nowMinutes >= HOUR_START * 60 && nowMinutes < HOUR_END * 60;

  // Per-appointment "is in the past" lookup. An appointment is past when
  // its end time (start + svc duration) is before now. We collapse the
  // calc into a Map keyed by apt id so the render loop is a Map.get(id)
  // and the closure can stay slim. Same approach for blocks below.
  const aptIsPast = useMemo(() => {
    const map = new Map<number | string, boolean>();
    for (const a of apts) {
      if (a.date !== isoDate) continue;
      // Parse "HH:MM" + duration → absolute LOCAL ms (using Date(y,m,d,h,m)
      // rather than Date.UTC) so a 14:00 appointment in Warsaw counts as
      // past at 14:31 local — not 14:31 UTC. Mirrors the .getHours() math
      // already used for the red `now` line marker.
      const [hh, mm] = (a.time ?? "00:00").split(":").map(Number);
      const [y, mo, d] = isoDate.split("-").map(Number);
      const localStartMs = new Date(y!, mo! - 1, d!, hh!, mm!).getTime();
      const dur = typeof a.duration === "number" && a.duration > 0 ? a.duration : 60;
      map.set(a.id, localStartMs + dur * 60_000 < nowMs);
    }
    return map;
  }, [apts, isoDate, nowMs]);

  const blockIsPast = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const b of blocks ?? []) {
      // Multi-day blocks: past only when the END date is before today.
      if (b.endDate && b.endDate !== isoDate) {
        map.set(b.id, b.endDate < todayIso);
        continue;
      }
      const [hh, mm] = (b.time ?? "00:00").split(":").map(Number);
      const [y, mo, d] = b.date.split("-").map(Number);
      const localStartMs = new Date(y!, mo! - 1, d!, hh!, mm!).getTime();
      const dur = b.durationMin > 0 ? b.durationMin : 30;
      map.set(b.id, localStartMs + dur * 60_000 < nowMs);
    }
    return map;
  }, [blocks, isoDate, todayIso, nowMs]);

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
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={goPrev}
            data-testid="day-view-prev"
            className="p-2 rounded-xl text-brand-600 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
            aria-label={t("salon.day.prev", lang)}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={goToday}
            data-testid="day-view-today"
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
          >
            {t("salon.cal.todaySmall", lang)}
          </button>
          <button
            onClick={goNext}
            data-testid="day-view-next"
            className="p-2 rounded-xl text-brand-600 dark:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors"
            aria-label={t("salon.day.next", lang)}
          >
            <ChevronRight className="h-5 w-5" />
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
          style={{ maxHeight: "clamp(400px, calc(100dvh - 280px), 90dvh)" }}
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
                  // data-day attribute is what useDragToMove keys off to
                  // resolve the column under the cursor. Skipping it on
                  // the synthetic Unassigned column (-1) makes that
                  // column non-draggable as a drop target.
                  {...(master.chatId !== -1 ? { "data-day": isoDate } : {})}
                >
                  {/* Header — kept as a 48px band even in single-column mode
                      so the hour-scale alignment (and the +48 offset on the
                      `now` red line at line ~893) stays correct. In single-
                      column mode the avatar + name strip is suppressed: the
                      master knows whose calendar they're looking at, and the
                      "?" + "#<chatId>" fallback for missing names is pure
                      noise. */}
                  {singleColumnMode ? (
                    <div
                      data-testid="day-view-master-column-header-blank"
                      className="h-12 border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/40 sticky top-0 z-10 backdrop-blur-sm"
                    />
                  ) : (
                    <div
                      data-testid="day-view-master-column-header"
                      className="h-12 flex items-center gap-2 px-3 border-b border-slate-200 dark:border-white/10 bg-white/70 dark:bg-slate-900/40 sticky top-0 z-10 backdrop-blur-sm"
                    >
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
                  )}

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
                    onCreateAt={
                      master.chatId === -1 || !onCreateAt
                        ? undefined
                        : (info) =>
                            setCreateSlot({
                              date: info.date,
                              time: info.time,
                              durationMin: info.durationMin,
                              masterId: info.masterId,
                              rect: info.anchorRect ?? null,
                            })
                    }
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
                    {(() => {
                    // Google-Calendar-style overlap lanes — bookings sharing a
                    // window split this column into side-by-side sub-columns.
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
                      const laneWidthPct = (100 - 4) / placement.lanes;
                      const laneLeftPct = placement.lane * laneWidthPct;
                      const isCancelled = !!a.cancelled || a.status === "cancelled" || a.status === "rejected";
                      const isNoShow = !!a.noShow;
                      const isTerminal = isCancelled || isNoShow || a.status === "done";
                      const isPast = aptIsPast.get(a.id) === true;
                      // Hierarchy: cancelled/no-show always read as "discarded"
                      // (opacity-40, more aggressive than past). Pure past
                      // events get a lighter wash so their brand color still
                      // signals confirmed/pending/done.
                      const dimClass = isCancelled || isNoShow
                        ? "opacity-40"
                        : isPast
                          ? "opacity-70 saturate-50"
                          : "";
                      const isSelected = selectedApt?.id === a.id;
                      const isDraggingSelf = draggingId === a.id;
                      // Fade the source block while its drag ghost is shown.
                      const dragOpacity = isDraggingSelf ? 0.3 : undefined;
                      // Terminal rows + the synthetic Unassigned column
                      // are not drop targets — skip the drag wire-up.
                      const drag =
                        !isTerminal && master.chatId !== -1 && onMoveAppointment
                          ? bindBlock({
                              appointmentId: a.id,
                              date: isoDate,
                              masterId: master.chatId as number,
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
                          data-testid="day-view-event"
                          data-apt-id={a.id}
                          data-selected={isSelected ? "1" : "0"}
                          data-past={isPast ? "1" : "0"}
                          className={`absolute rounded-lg px-2 py-1 text-left transition-all overflow-hidden ring-1 ring-transparent hover:ring-slate-300 dark:hover:ring-white/20 hover:-translate-y-px hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${dimClass} ${
                            isSelected ? "ring-2 ring-offset-1 shadow-md" : ""
                          } ${drag ? "cursor-grab active:cursor-grabbing" : ""}`}
                          style={{
                            top,
                            height,
                            // Lane geometry — side-by-side when overlapping.
                            left: `calc(${laneLeftPct}% + 2px)`,
                            width: `calc(${laneWidthPct}% - 2px)`,
                            background: tone.bg,
                            borderLeft: `3px solid ${tone.border}`,
                            ...(dragOpacity !== undefined ? { opacity: dragOpacity } : {}),
                            ...(drag?.style ?? {}),
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
                          {(a.serviceName ?? a.svcId) && height >= HOUR_HEIGHT * 0.75 && placement.lanes <= 2 && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {a.serviceName ?? a.svcId}
                            </div>
                          )}
                        </button>
                      );
                    });
                    })()}

                    {/* Empty-state overlay — single-column (master self-view)
                        mode only, fires when the visible day has zero
                        appointments AND zero blocks for THIS master. Sits
                        on top of the empty grid lines but doesn't block
                        DragCreateLayer's pointer events, so the master can
                        still click-drag in the empty grid to create a block. */}
                    {singleColumnMode &&
                      list.length === 0 &&
                      (blocksByMaster.get(master.chatId as number) ?? []).length === 0 && (
                        <div
                          data-testid="day-view-empty-master"
                          className="absolute inset-x-2 pointer-events-none flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500 px-4"
                          style={{ top: 0, height: TOTAL_HOURS * HOUR_HEIGHT }}
                        >
                          <p className="text-sm font-semibold">
                            {t("master.schedule.emptyDay.title", lang)}
                          </p>
                          <p className="text-xs mt-1 max-w-[240px]">
                            {t("master.schedule.emptyDay.subtitle", lang)}
                          </p>
                        </div>
                      )}

                    {/* Drag-to-reschedule ghost — rendered in whichever
                        master column is currently under the cursor. The
                        column resolution happens inside useDragToMove via
                        data-day + data-master-id on the column wrapper. */}
                    {moveGhost &&
                      moveGhost.date === isoDate &&
                      moveGhost.masterId === (master.chatId as number) && (
                        <div
                          aria-hidden
                          data-testid="day-view-move-ghost"
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
                        Hatched grey fill, lock icon, no client column. Click
                        opens a styled ConfirmDialog (replaces the old
                        window.confirm); on confirm calls `onDeleteBlock`
                        to soft-cancel the row. */}
                    {(blocksByMaster.get(master.chatId as number) ?? []).map((b) => {
                      const isMultiDay = !!b.endDate && b.endDate !== isoDate;
                      const top = isMultiDay ? 0 : timeToTop(b.time);
                      const height = isMultiDay
                        ? TOTAL_HOURS * HOUR_HEIGHT
                        : Math.max(HOUR_HEIGHT * 0.5, (b.durationMin / 60) * HOUR_HEIGHT);
                      const isPast = blockIsPast.get(b.id) === true;
                      const dimClass = isPast ? "opacity-70 saturate-50" : "";
                      return (
                        <button
                          type="button"
                          key={b.id}
                          data-testid="day-view-block"
                          data-block-id={b.id}
                          data-block-type={b.type}
                          data-past={isPast ? "1" : "0"}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!onDeleteBlock) return;
                            setBlockToDelete(b.id);
                          }}
                          className={`absolute left-1 right-1 rounded-lg px-2 py-1 text-left overflow-hidden border border-dashed flex flex-col gap-0.5 hover:opacity-80 transition-opacity ${dimClass}`}
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

      {/* Selected appointment — rich detail panel when consumer wires the
          tenantId + services props (SalonDashboard does); otherwise the
          legacy AptCard inline view (AppointmentsPageClient). */}
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
            // Drop the local selection — parent's refetch will rehydrate
            // with the updated row and the user can reopen the panel.
            setSelectedApt(null);
          }}
        />
      ) : selectedApt ? (
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
      ) : null}

      {/* Styled confirm for block deletion — replaces window.confirm. */}
      <ConfirmDialog
        open={blockToDelete !== null}
        title={t("salon.day.deleteBlockTitle", lang)}
        description={t("salon.day.deleteBlockDesc", lang)}
        confirmLabel={t("common.delete", lang)}
        cancelLabel={t("common.cancel", lang)}
        tone="danger"
        onConfirm={() => {
          if (blockToDelete && onDeleteBlock) onDeleteBlock(blockToDelete);
          setBlockToDelete(null);
        }}
        onCancel={() => setBlockToDelete(null)}
      />

      {createSlot && (
        <CreateSlotPopover
          anchorRect={createSlot.rect}
          date={createSlot.date}
          time={createSlot.time}
          durationMin={createSlot.durationMin}
          masterName={masters.find((m) => m.chatId === createSlot.masterId)?.name ?? undefined}
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
