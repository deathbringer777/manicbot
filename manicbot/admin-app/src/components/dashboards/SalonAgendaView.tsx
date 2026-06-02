"use client";

/**
 * SalonAgendaView — Google Calendar-style agenda list.
 *
 * Dense, single-line rows grouped by day. Replaces the older bulky
 * AptCard-per-row layout with a compact GCal/Booksy hybrid:
 *
 *   Today
 *   ●  10:00 – 11:00   Мария Иванова   manicure_classic                    Confirmed
 *   ○  11:30 – 13:00   Karolina Nowak  gel_polish                          Pending  [Confirm] [Reject]
 *   ●  14:00 – 15:30   Анна Сидорова   pedicure_spa                        Confirmed
 *
 *   Friday, May 8
 *   ●  12:00 – 13:00   Daria Kowalska  gel_polish                          Confirmed
 *
 * Pending rows show inline Confirm/Reject buttons (the highest-priority
 * actions). Confirmed rows show a "•••" menu that opens Cancel /
 * Client no-show / Master no-show. Cancelled and no-show rows are faded
 * out and read-only.
 *
 * The row uses the master's color (passed in via `mastersById`) for the
 * leading dot — same palette as SalonDayView/Week. Falls back to the
 * status tone when the master isn't known.
 */

import { useMemo, useState, useEffect, useRef, type ReactNode } from "react";
import { CalendarDays, Loader2, MoreHorizontal, CheckCircle2, XCircle, UserX, AlertTriangle } from "lucide-react";
import { EmptyState } from "~/components/ui/EmptyState";
import { STATUS_TONE } from "~/components/dashboards/CalendarLeftRail";
import { t, type Lang } from "~/lib/i18n";

const MASTER_PALETTE = [
  "#7c3aed",
  "#0b9b6b",
  "#0891b2",
  "#ec4899",
  "#d97706",
  "#2563eb",
  "#9333ea",
  "#0d9488",
] as const;

type AgendaApt = Record<string, any> & {
  id: number | string;
  date: string;
  time: string;
  status?: string;
};

interface MasterMeta {
  chatId: number;
  name: string | null;
}

interface Props {
  apts: AgendaApt[];
  isLoading: boolean;
  lang: Lang;
  /** Confirm / reject / cancel callback. Optional — master role has no
   *  `appointments.updateStatus` equivalent, so the master-side ScheduleTab
   *  passes `undefined` and the row hides the affordance. */
  onAction?: (id: number | string, status: "confirmed" | "cancelled" | "rejected") => void;
  /** Mark-no-show callback. Optional — same rationale as `onAction`. */
  onNoShow?: (id: number | string, noShowBy: "client" | "master") => void;
  /** Optional master list — used to color rows + show master name. */
  masters?: MasterMeta[];
  /** Optional service list — used to look up display names. svcId → name. */
  serviceNames?: Record<string, string>;
  /**
   * Hint that filters in a parent rail removed everything. When true and
   * `apts` is empty, we show "filtered out" instead of "no upcoming".
   */
  filtersActive?: boolean;
  /** Rendered in a top bar (right-aligned) — the calendar view switcher.
   *  The agenda has no date nav of its own, so this is its only header. */
  headerRight?: ReactNode;
}

interface DayGroup {
  iso: string;
  apts: AgendaApt[];
}

function groupByDay(apts: AgendaApt[]): DayGroup[] {
  const map = new Map<string, AgendaApt[]>();
  for (const a of apts) {
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date)!.push(a);
  }
  const groups: DayGroup[] = [];
  for (const [iso, list] of map) {
    list.sort((x, y) => (x.time ?? "").localeCompare(y.time ?? ""));
    groups.push({ iso, apts: list });
  }
  groups.sort((a, b) => a.iso.localeCompare(b.iso));
  return groups;
}

function formatDayLabel(iso: string, lang: Lang): string {
  const locale =
    lang === "ua" ? "uk-UA" : lang === "pl" ? "pl-PL" : lang === "en" ? "en-US" : "ru-RU";
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowIso = tomorrow.toISOString().slice(0, 10);
  if (iso === todayIso) return t("salon.cal.today", lang);
  if (iso === tomorrowIso) {
    return locale.startsWith("ru")
      ? "Завтра"
      : locale.startsWith("uk")
        ? "Завтра"
        : locale.startsWith("pl")
          ? "Jutro"
          : "Tomorrow";
  }
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":");
  const total = (Number(h ?? 0) * 60 + Number(m ?? 0) + minutes) % (24 * 60);
  const safe = total < 0 ? 0 : total;
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

function statusKeyOf(a: AgendaApt): string {
  if (a.noShow) return "no_show";
  if (a.cancelled || a.status === "cancelled" || a.status === "rejected") return "cancelled";
  if (a.status === "done") return "done";
  if (a.status === "confirmed") return "confirmed";
  return "pending";
}

interface RowProps {
  a: AgendaApt;
  lang: Lang;
  masterColor: string;
  masterName: string | null;
  serviceName: string;
  /** Optional — see SalonAgendaView Props comments. */
  onAction?: Props["onAction"];
  /** Optional — see SalonAgendaView Props comments. */
  onNoShow?: Props["onNoShow"];
}

function AgendaRow({ a, lang, masterColor, masterName, serviceName, onAction, onNoShow }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const status = statusKeyOf(a);
  const tone = STATUS_TONE[status] ?? STATUS_TONE.pending!;
  const isMuted = status === "cancelled" || status === "no_show";
  const isPending = status === "pending" && !a.cancelled && !a.noShow;
  const isConfirmed = status === "confirmed" && !a.cancelled && !a.noShow;
  const startTime = a.time ?? "00:00";
  const endTime = a.duration ? addMinutes(startTime, Number(a.duration)) : null;

  // Close popover on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const statusLabel = t(`status.${status}` as any, lang);

  return (
    <div
      data-testid="agenda-row"
      data-apt-id={a.id}
      data-status={status}
      className={`group flex items-center gap-3 px-2 py-2 rounded-lg border-l-2 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03] ${
        isMuted ? "opacity-55" : ""
      }`}
      style={{ borderLeftColor: masterColor }}
    >
      {/* Master color dot */}
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ background: masterColor }}
        aria-hidden
      />

      {/* Time range */}
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200 w-[88px]">
        {startTime}
        {endTime && (
          <span className="text-slate-400 dark:text-slate-500 font-normal"> – {endTime}</span>
        )}
      </span>

      {/* Client name + service */}
      <div className="flex-1 min-w-0 flex items-baseline gap-2">
        <span
          className={`text-[12px] font-medium truncate ${
            isMuted ? "line-through" : "text-slate-900 dark:text-white"
          }`}
        >
          {a.userName ?? a.userTg ?? `#${a.chatId ?? ""}`}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate hidden sm:inline">
          {serviceName}
        </span>
        {masterName && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate hidden md:inline">
            · {masterName}
          </span>
        )}
      </div>

      {/* Status pill */}
      <span
        className="hidden sm:inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
        style={{ background: tone.bg, color: tone.text }}
        data-testid="agenda-row-status"
      >
        {statusLabel}
      </span>

      {/* Inline actions — only when the caller wired a confirm/reject mutation.
          Master role has no `appointments.updateStatus` analogue and passes
          `onAction === undefined`, so the buttons stay hidden. */}
      {isPending && onAction && (
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onAction(a.id, "confirmed")}
            data-testid="agenda-row-confirm"
            className="p-1.5 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-colors"
            aria-label={t("salon.agenda.confirm", lang)}
            title={t("salon.agenda.confirm", lang)}
          >
            <CheckCircle2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onAction(a.id, "rejected")}
            data-testid="agenda-row-reject"
            className="p-1.5 rounded-md text-red-600 dark:text-red-400 hover:bg-red-500/15 transition-colors"
            aria-label={t("salon.agenda.reject", lang)}
            title={t("salon.agenda.reject", lang)}
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* "..." menu for confirmed rows — opens Cancel / no-show actions.
          Hidden entirely when the row has neither callback wired (read-only). */}
      {isConfirmed && (onAction || onNoShow) && (
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            data-testid="agenda-row-menu"
            data-open={menuOpen ? "1" : "0"}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors opacity-0 group-hover:opacity-100 data-[open=1]:opacity-100"
            aria-label={t("salon.agenda.more", lang)}
            title={t("salon.agenda.more", lang)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              data-testid="agenda-row-menu-popover"
              className="absolute right-0 top-full mt-1 z-20 w-52 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 shadow-lg p-1 text-left"
              role="menu"
            >
              {onAction && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onAction(a.id, "cancelled");
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <XCircle className="h-3.5 w-3.5" /> {t("salon.agenda.cancel", lang)}
                </button>
              )}
              {onNoShow && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNoShow(a.id, "client");
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors"
                >
                  <UserX className="h-3.5 w-3.5" /> {t("salon.agenda.clientNoShow", lang)}
                </button>
              )}
              {onNoShow && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNoShow(a.id, "master");
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors"
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> {t("salon.agenda.masterNoShow", lang)}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SalonAgendaView({
  apts,
  isLoading,
  lang,
  onAction,
  onNoShow,
  masters,
  serviceNames,
  filtersActive,
  headerRight,
}: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const masterIndex = useMemo(() => {
    const m = new Map<number, { color: string; name: string | null }>();
    (masters ?? []).forEach((master, idx) => {
      m.set(master.chatId, {
        color: MASTER_PALETTE[idx % MASTER_PALETTE.length]!,
        name: master.name,
      });
    });
    return m;
  }, [masters]);

  const { upcoming, past } = useMemo(() => {
    const u: AgendaApt[] = [];
    const p: AgendaApt[] = [];
    for (const a of apts) {
      if (a.date >= todayIso) u.push(a);
      else p.push(a);
    }
    return { upcoming: groupByDay(u), past: groupByDay(p).reverse() };
  }, [apts, todayIso]);

  // The agenda has no date nav of its own, so the view switcher (headerRight)
  // rides in a thin top bar above whatever body renders (loading/empty/list).
  const wrap = (node: ReactNode) => (
    <div className="space-y-3" data-testid="salon-agenda-view">
      {headerRight && (
        <div className="flex items-center justify-end" data-testid="agenda-header">
          {headerRight}
        </div>
      )}
      {node}
    </div>
  );

  if (isLoading) {
    return wrap(
      <div className="flex justify-center py-8" data-testid="agenda-loading">
        <Loader2 className="animate-spin text-brand-400" />
      </div>
    );
  }

  if (upcoming.length === 0 && past.length === 0) {
    if (filtersActive) {
      return wrap(
        <EmptyState
          icon={CalendarDays}
          title={t("salon.agenda.allFiltered", lang)}
          description={t("salon.agenda.allFilteredHint", lang)}
        />
      );
    }
    return wrap(
      <EmptyState
        icon={CalendarDays}
        title={t("salon.cal.noUpcoming", lang)}
        description={t("salon.empty.apts", lang)}
      />
    );
  }

  const renderRow = (a: AgendaApt) => {
    const masterMeta = a.masterId != null ? masterIndex.get(Number(a.masterId)) : undefined;
    const status = statusKeyOf(a);
    const fallbackColor = STATUS_TONE[status]?.dot ?? "#94a3b8";
    return (
      <AgendaRow
        key={a.id}
        a={a}
        lang={lang}
        masterColor={masterMeta?.color ?? fallbackColor}
        masterName={masterMeta?.name ?? null}
        serviceName={(serviceNames && a.svcId ? serviceNames[a.svcId] : null) ?? a.svcId ?? ""}
        onAction={onAction}
        onNoShow={onNoShow}
      />
    );
  };

  return wrap(
    <div className="glass-card rounded-2xl overflow-hidden" data-testid="agenda-view">
      <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
        {upcoming.length > 0 && (
          <section data-testid="agenda-upcoming">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 pt-3 pb-1.5 sticky top-0 bg-white/95 dark:bg-slate-900/80 backdrop-blur-sm z-10">
              {t("salon.cal.upcoming", lang)}
            </h3>
            <div>
              {upcoming.map((g) => (
                <div key={g.iso} data-day={g.iso}>
                  <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-900 dark:text-white capitalize px-3 py-2 bg-slate-50/80 dark:bg-white/[0.03] border-y border-slate-100 dark:border-white/[0.04]">
                    <span className="truncate">{formatDayLabel(g.iso, lang)}</span>
                    <span className="text-[9px] font-semibold tabular-nums text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full bg-slate-200/60 dark:bg-white/[0.06]">
                      {g.apts.length}
                    </span>
                  </h4>
                  <div className="px-1 py-1 space-y-px">{g.apts.map(renderRow)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section data-testid="agenda-past" className="opacity-90">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-3 pt-3 pb-1.5 sticky top-0 bg-white/95 dark:bg-slate-900/80 backdrop-blur-sm z-10">
              {t("salon.cal.past", lang)}
            </h3>
            <div>
              {past.map((g) => (
                <div key={g.iso} data-day={g.iso}>
                  <h4 className="flex items-center gap-2 text-[11px] font-bold text-slate-900 dark:text-white capitalize px-3 py-2 bg-slate-50/80 dark:bg-white/[0.03] border-y border-slate-100 dark:border-white/[0.04]">
                    <span className="truncate">{formatDayLabel(g.iso, lang)}</span>
                    <span className="text-[9px] font-semibold tabular-nums text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full bg-slate-200/60 dark:bg-white/[0.06]">
                      {g.apts.length}
                    </span>
                  </h4>
                  <div className="px-1 py-1 space-y-px">{g.apts.map(renderRow)}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
