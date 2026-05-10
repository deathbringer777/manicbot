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
import { ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react";
import { t, type Lang } from "~/lib/i18n";
import { AptCard } from "~/components/dashboard-ui/AptCard";

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
  workHours?: string | null; // optional JSON: { mon: "09:00-19:00", ... }
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

interface Props {
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

export function SalonDayView({
  date,
  setDate,
  apts,
  masters,
  isLoading,
  lang,
  onAction,
  onNoShow,
}: Props) {
  const isoDate = fmtIsoDate(date);
  const [selectedApt, setSelectedApt] = useState<AptRow | null>(null);
  const todayIso = fmtIsoDate(new Date());
  const isToday = isoDate === todayIso;
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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

  const masterColumns = useMemo(() => {
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

      {/* Empty state — no masters */}
      {masterColumns.length === 0 && (
        <div className="glass-card rounded-2xl py-12 px-4 text-center" data-testid="day-view-empty">
          <Users className="h-8 w-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("salon.day.noMasters", lang)}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t("salon.empty.masters", lang)}</p>
        </div>
      )}

      {/* Hour grid + master columns */}
      {masterColumns.length > 0 && (
        <div
          ref={scrollerRef}
          className="glass-card rounded-2xl overflow-auto"
          style={{ maxHeight: "calc(100vh - 280px)" }}
        >
          <div className="flex" style={{ minWidth: 80 + masterColumns.length * 180 }}>
            {/* Hour scale */}
            <div className="shrink-0 w-20 sticky left-0 z-10 bg-white/95 dark:bg-slate-900/80 backdrop-blur-sm border-r border-slate-200 dark:border-white/5">
              <div className="h-12 border-b border-slate-200 dark:border-white/5" />
              {Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i).map((h) => (
                <div
                  key={h}
                  className="text-[10px] text-slate-400 dark:text-slate-500 text-right pr-2 border-b border-slate-100 dark:border-white/5"
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
                  className="flex-1 min-w-[180px] border-r border-slate-100 dark:border-white/5 last:border-r-0 relative"
                  data-testid="day-view-master-column"
                  data-master-id={master.chatId}
                >
                  {/* Header */}
                  <div className="h-12 flex items-center gap-2 px-3 border-b border-slate-200 dark:border-white/5 bg-white/70 dark:bg-slate-900/40 sticky top-0 z-10 backdrop-blur-sm">
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

                  {/* Body — hour-rule lines */}
                  <div
                    className="relative"
                    style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}
                    data-testid="day-view-column-body"
                  >
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => i).map((i) => (
                      <div
                        key={i}
                        className="border-b border-slate-100 dark:border-white/[0.04] absolute left-0 right-0"
                        style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Appointment blocks */}
                    {list.map((a) => {
                      const top = timeToTop(a.time);
                      const height = durationToHeight(a.duration);
                      const isCancelled = !!a.cancelled || a.status === "cancelled" || a.status === "rejected";
                      const isNoShow = !!a.noShow;
                      const opacity = isCancelled || isNoShow ? 0.45 : 1;
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => setSelectedApt(a)}
                          data-testid="day-view-event"
                          data-apt-id={a.id}
                          className="absolute left-1 right-1 rounded-lg px-2 py-1 text-left transition-shadow hover:shadow-lg overflow-hidden"
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
                          <div className="text-[11px] font-medium text-slate-800 dark:text-white truncate leading-tight">
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
                  </div>
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
